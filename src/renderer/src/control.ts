import type { AgentState } from '../../shared/types'
import * as A from './actions'
import * as browsers from './browsers'
import { applyReport } from './osc'
import { sessionStatus, store } from './store'
import * as terms from './terminals'

// Requests from the `tezgah` command (see resources/bin/tezgah-cli.js), answered here because
// the renderer owns sessions and panes.

type Args = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)

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
      if (url) return void A.openBrowser(url, need().id)
      const path = str(args.path)
      if (path) return void A.openFolder(path)
      throw new Error('nothing to open')
    }
    case 'browser': {
      const session = need()
      const action = String(args.action)
      if (action === 'open') return void A.openBrowser(str(args.url) ?? 'about:blank', session.id)
      const pane = session.panes.find((p) => p.kind === 'browser')
      const view = pane && browsers.get(pane.id)
      if (!view) throw new Error('this session has no browser pane; tezgah browser <url> opens one')
      if (action === 'reload') return void view.reload()
      if (action === 'back') return void view.goBack()
      if (action === 'forward') return void view.goForward()
      if (action === 'text') return await view.executeJavaScript('document.body ? document.body.innerText : ""')
      if (action === 'eval') return await view.executeJavaScript(String(args.script ?? ''))
      throw new Error(`unknown browser action ${action}`)
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
