import type { AgentState } from '../../shared/types'
import * as A from './actions'
import * as browsers from './browsers'
import { agentName, markHooked } from './activity'
import { applyReport } from './osc'
import { sessionStatus, store } from './store'
import * as terms from './terminals'

// Requests from the `tezgah` command (see resources/bin/tezgah-cli.js), answered here because
// the renderer owns sessions and panes.

type Args = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)

/** A browser pane's page, once it exists. */
async function contentsOf(paneId: string, timeout: number): Promise<number> {
  const end = Date.now() + timeout
  for (;;) {
    const id = browsers.contentsId(paneId)
    if (id !== undefined) return id
    if (Date.now() > end) throw new Error('the browser pane did not start')
    await new Promise((r) => setTimeout(r, 100))
  }
}

async function handle(cmd: string, args: Args, callerPane?: string): Promise<unknown> {
  const caller = callerPane ? A.sessionOfPane(callerPane) : undefined
  const s = caller ?? A.selected()
  const need = () => {
    if (!s) throw new Error('no session')
    return s
  }

  switch (cmd) {
    case 'notify': {
      const session = need()
      A.addNote(session.id, callerPane, 'notice', str(args.title) ?? session.title, str(args.body) ?? '')
      return true
    }
    case 'status': {
      if (!callerPane) throw new Error('run it inside a Tezgah terminal')
      const state = String(args.state)
      if (state === 'clear') store().setPane(callerPane, (p) => ({ records: applyReport(p.records, { clear: true, id: '' }) }))
      else if (['idle', 'working', 'done', 'blocked', 'error'].includes(state))
        store().setPane(callerPane, (p) => ({
          records: applyReport(p.records, { clear: false, record: { id: '', state: state as AgentState, message: str(args.message) } }),
        }))
      else throw new Error('state must be working, done, blocked, idle, error or clear')
      return true
    }
    case 'split': {
      const session = need()
      if (callerPane) A.focusPane(session.id, callerPane)
      const pane = A.split(args.dir === 'column' ? 'column' : 'row', 'shell', { command: str(args.command) }, session.id)
      return pane?.id
    }
    case 'new': {
      const dir = str(args.dir)
      const project = dir ? A.addProject(dir) : A.project(s?.projectId)
      if (!project) throw new Error('no project; pass --dir')
      const command = str(args.command)
      const created = A.newSession(project.id, args.kind === 'shell' ? 'shell' : 'claude')
      if (!created) throw new Error('could not create a session')
      if (command) A.updatePane(created.id, created.panes[0].id, { command })
      const title = str(args.title)
      if (title) A.retitle(created.id, title)
      return created.id
    }
    case 'open': {
      const url = str(args.url)
      if (url) return handle('browser', { action: 'open', url }, callerPane)
      const path = str(args.path)
      if (path) return void A.openFolder(path)
      throw new Error('nothing to open')
    }
    case 'browser': {
      const session = need()
      const action = String(args.action)
      if (action === 'open') {
        const url = str(args.url) ?? 'about:blank'
        const paneId = A.openBrowser(url, session.id, str(args.pane), !!args.newPane)
        if (!paneId) throw new Error('could not open a browser pane')
        const id = await contentsOf(paneId, 15000)
        return { pane: paneId, ...(await window.tz.browserAct(id, 'load', {}) as object) }
      }
      const paneId = str(args.pane) ?? session.panes.find((p) => p.kind === 'browser')?.id
      if (!paneId) throw new Error('this session has no browser pane; open one first (tezgah browser open <url>)')
      return window.tz.browserAct(await contentsOf(paneId, 5000), action, args)
    }
    case 'send': {
      const session = need()
      const target = str(args.pane) ?? session.panes.find((p) => p.kind === 'claude' && p.id !== callerPane)?.id ??
        session.panes.find((p) => p.id !== callerPane && p.kind !== 'browser')?.id
      if (!target) throw new Error('no pane to send to; pass --pane')
      terms.paste(target, String(args.text ?? ''), !!args.enter)
      return true
    }
    case 'read': {
      const target = str(args.pane) ?? callerPane ?? s?.focusedPane
      if (!target) throw new Error('no pane')
      return terms.screenText(target, typeof args.lines === 'number' ? args.lines : 200)
    }
    case 'hook': {
      // An agent's own hooks (Codex through Tezgah's wrapper): exact state, so output isn't read for it.
      if (!callerPane) return true
      markHooked(callerPane)
      const agent = str(args.agent) ?? 'agent'
      const what = [str(args.tool), str(args.detail)].filter(Boolean).join(' ') || undefined
      const event = String(args.event)
      const next: { state: AgentState; kind?: 'permission'; message?: string } | undefined =
        event === 'session-start' ? { state: 'idle' }
        : event === 'prompt-submit' || event === 'post-tool-use' ? { state: 'working' }
        : event === 'pre-tool-use' ? { state: 'working', message: what }
        : event === 'permission-request' ? { state: 'blocked', kind: 'permission', message: what }
        : event === 'stop' ? { state: 'done' }
        : undefined
      if (next) store().setPane(callerPane, (p) => ({ records: applyReport(p.records, { clear: false, record: { id: '', app: agent, ...next } }) }))
      const s = A.sessionOfPane(callerPane)
      if (s && !s.customTitle && A.isDefaultTitle(s.title)) A.adoptTitle(s.id, agentName(agent))
      return true
    }
    case 'list': {
      const { panes } = store()
      return A.orderedSessions().map((x) => ({
        id: x.id,
        title: x.title,
        project: A.project(x.projectId)?.name,
        status: sessionStatus(x, panes),
        panes: x.panes.map((p) => ({ id: p.id, kind: p.kind, focused: p.id === x.focusedPane, url: p.url })),
      }))
    }
    case 'run': {
      const ok = A.runCustomCommand(String(args.name ?? ''), need().id)
      if (!ok) throw new Error(`no custom command named "${args.name}"`)
      return true
    }
    case 'focus': {
      const id = str(args.session)
      if (!id || !A.session(id)) throw new Error('no such session')
      A.select(id)
      return true
    }
  }
  throw new Error(`unknown command ${cmd}`)
}

export function startControl(): () => void {
  return window.tz.onControl(async (id, req) => {
    try {
      const result = await handle(req.cmd, req.args ?? {}, req.pane)
      window.tz.controlReply(id, { ok: true, result: result === undefined ? true : result })
    } catch (e) {
      window.tz.controlReply(id, { ok: false, error: A.errorText(e) })
    }
  })
}
