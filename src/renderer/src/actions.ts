import type { Pane, PaneKind, Project, Session } from '../../shared/types'
import {
  type Note, blockedPane, layoutPanes, newPane, removeFromLayout, sessionCwd, sessionStatus, splitLayout, store, uid, useStore,
} from './store'
import * as terms from './terminals'
import { normalizeUrl } from './paths'

export const normalizeAddress = normalizeUrl

const basename = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p

export function project(id?: string): Project | undefined {
  return store().ws.projects.find((p) => p.id === id)
}

export function session(id?: string): Session | undefined {
  return store().ws.sessions.find((s) => s.id === id)
}

export function selected(): Session | undefined {
  return session(store().ws.selectedSession)
}

function updateSession(id: string, fn: (s: Session) => Session): void {
  store().setWs((ws) => ({ ...ws, sessions: ws.sessions.map((s) => (s.id === id ? fn(s) : s)) }))
}

/** Single-quoted for zsh, bash, fish and PowerShell alike. */
const quote = (s: string) => `'${s.replace(/'/g, window.tz.platform === 'win32' ? "''" : `'\\''`)}'`

/** What a pane runs at start: a Claude conversation it can resume, or just the shell. */
export async function startCommand(pane: Pane): Promise<string | undefined> {
  if (pane.kind === 'shell') return pane.command
  if (pane.kind !== 'claude' || !pane.claudeId) return undefined
  const exists = await window.tz.claudeHasConversation(pane.claudeId)
  const extra = store().settings.claudeArgs.trim()
  // Tezgah's browser and pane tools, for this session only.
  const tools = store().settings.agentTools ? await window.tz.mcpConfig(pane.id).then((f) => ` --mcp-config ${quote(f)}`, () => '') : ''
  return `claude ${exists ? '--resume' : '--session-id'} ${pane.claudeId}${tools}${extra ? ' ' + extra : ''}`
}

/** How a pane starts: its folder and command. Resolved synchronously from a pre-fetched command. */
export function paneStart(sessionId: string, paneId: string, command: string | undefined) {
  return () => {
    const s = session(sessionId)
    return { cwd: s ? sessionCwd(s, project(s.projectId)) : '', command }
  }
}

// Projects

export function addProject(path: string): Project {
  const existing = store().ws.projects.find((p) => p.path === path)
  if (existing) return existing
  const p: Project = { id: uid(), name: basename(path), path, worktrees: false }
  store().setWs((ws) => ({ ...ws, projects: [...ws.projects, p] }))
  return p
}

export async function openFolder(path?: string): Promise<void> {
  const folder = path ?? (await window.tz.pickFolder())
  if (!folder) return
  const p = addProject(folder)
  const has = store().ws.sessions.some((s) => s.projectId === p.id)
  if (!has) newSession(p.id, 'claude')
  else select(store().ws.sessions.find((s) => s.projectId === p.id)!.id)
}

export function removeProject(id: string): void {
  for (const s of store().ws.sessions.filter((s) => s.projectId === id)) disposeSession(s)
  store().setWs((ws) => ({
    ...ws,
    projects: ws.projects.filter((p) => p.id !== id),
    sessions: ws.sessions.filter((s) => s.projectId !== id),
  }))
}

export function toggleProject(id: string): void {
  store().setWs((ws) => ({ ...ws, projects: ws.projects.map((p) => (p.id === id ? { ...p, collapsed: !p.collapsed } : p)) }))
}

// Sessions

export function select(id: string | undefined): void {
  store().setWs((ws) => ({ ...ws, selectedSession: id }))
  if (id) useSeen(id)
  const s = session(id)
  if (s) seenPane(s.focusedPane)
}

function useSeen(id: string): void {
  if (!store().unseen[id]) return
  const unseen = { ...store().unseen }
  delete unseen[id]
  useStore.setState({ unseen })
}

/** "Shell", then "Shell 2", "Shell 3"… within a project, so sessions can be told apart. */
function uniqueTitle(projectId: string, base: string): string {
  const taken = new Set(store().ws.sessions.filter((s) => s.projectId === projectId).map((s) => s.title))
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base} ${n}`)) n++
  return `${base} ${n}`
}

/** A title Tezgah gave, which a better one (Claude's, the agent's name) may replace. */
export const isDefaultTitle = (t: string) => /^(Shell|New session)( \d+)?$/.test(t)

export function newSession(projectId: string | undefined, kind: PaneKind, worktree?: Session['worktree'], claudeId?: string): Session | undefined {
  const p = project(projectId) ?? store().ws.projects[0]
  if (!p) {
    openFolder()
    return undefined
  }
  const pane = newPane(kind)
  if (claudeId) pane.claudeId = claudeId
  const count = store().ws.sessions.filter((s) => s.projectId === p.id).length
  const base = worktree ? worktree.branch : kind === 'claude' ? 'New session' : 'Shell'
  const s: Session = {
    id: uid(),
    projectId: p.id,
    title: uniqueTitle(p.id, base),
    panes: [pane],
    layout: { type: 'pane', paneId: pane.id },
    focusedPane: pane.id,
    worktree,
    createdAt: Date.now() + count,
  }
  store().setWs((ws) => ({
    ...ws,
    projects: ws.projects.map((x) => (x.id === p.id ? { ...x, collapsed: false } : x)),
    sessions: [...ws.sessions, s],
    selectedSession: s.id,
  }))
  return s
}

export function newWorktreeSession(projectId?: string): void {
  const p = project(projectId) ?? project(selected()?.projectId) ?? store().ws.projects[0]
  if (!p) return
  store().setUI({
    prompt: {
      title: `New worktree in ${p.name}`,
      placeholder: 'Branch name, e.g. fix-login',
      value: '',
      confirm: 'Create',
      onSubmit: async (branch) => {
        if (!branch.trim()) return
        if (!(await window.tz.isGitRepo(p.path))) return toast(`${p.name} isn't a git repository.`)
        try {
          const wt = await window.tz.worktreeAdd(p.path, branch.trim())
          newSession(p.id, 'claude', wt)
        } catch (e) {
          toast(errorText(e))
        }
      },
    },
  })
}

/** A shell session on another machine through the user's own `ssh`. */
export function newSshSession(projectId?: string): void {
  store().setUI({
    prompt: {
      title: 'New SSH session',
      placeholder: 'user@host, or a Host from ~/.ssh/config',
      value: '',
      confirm: 'Connect',
      onSubmit: (raw) => {
        const target = raw.trim()
        if (!/^[\w.@:-]+$/.test(target) || target.startsWith('-')) return toast('Enter user@host or an ssh config Host.')
        const s = newSession(projectId ?? selected()?.projectId, 'shell')
        if (!s) return
        updatePane(s.id, s.panes[0].id, { command: `ssh ${target}`, ssh: target })
        retitle(s.id, target)
      },
    },
  })
}

/** Files dropped on a pane: paths typed locally, uploaded first on an SSH pane. */
export async function dropFiles(sessionId: string, paneId: string, paths: string[]): Promise<void> {
  const pane = session(sessionId)?.panes.find((p) => p.id === paneId)
  if (!pane?.ssh) return terms.insertPaths(paneId, paths)
  try {
    toast(`Uploading ${paths.length === 1 ? 'a file' : `${paths.length} files`} to ${pane.ssh}…`)
    terms.insertPaths(paneId, await window.tz.scpUpload(pane.ssh, paths))
  } catch (e) {
    toast(errorText(e))
  }
}

function disposeSession(s: Session): void {
  for (const pane of s.panes) terms.dispose(pane.id)
}

export function closeSession(id: string, force = false): void {
  const s = session(id)
  if (!s) return
  const p = project(s.projectId)
  const busy = ['working', 'blocked'].includes(sessionStatus(s, store().panes) ?? '')
  const finish = (removeWorktree?: boolean) => {
    disposeSession(s)
    if (s.worktree && removeWorktree && p) window.tz.worktreeRemove(p.path, s.worktree, true).catch(() => undefined)
    store().setWs((ws) => {
      const sessions = ws.sessions.filter((x) => x.id !== id)
      const i = ws.sessions.findIndex((x) => x.id === id)
      const next = ws.selectedSession === id ? (sessions[i] ?? sessions[i - 1])?.id : ws.selectedSession
      return { ...ws, sessions, selectedSession: next }
    })
  }
  if (s.worktree) {
    return store().setUI({
      confirm: {
        title: `Close “${s.title}”?`,
        body: `It has its own worktree on branch ${s.worktree.branch}. Keep it to continue later, or delete the folder and the branch.`,
        actions: [
          { label: 'Keep Worktree', run: () => finish(false) },
          { label: 'Delete Worktree', danger: true, run: () => finish(true) },
        ],
      },
    })
  }
  if (busy && !force) {
    return store().setUI({
      confirm: {
        title: `Close “${s.title}”?`,
        body: 'An agent is still working in it. Closing stops it.',
        actions: [{ label: 'Close', danger: true, run: () => finish() }],
      },
    })
  }
  finish()
}

export function renameSession(id: string): void {
  const s = session(id)
  if (!s) return
  store().setUI({
    prompt: {
      title: 'Rename session',
      value: s.title,
      confirm: 'Rename',
      onSubmit: (v) => v.trim() && updateSession(id, (x) => ({ ...x, title: v.trim(), customTitle: true })),
    },
  })
}

export function retitle(id: string, title: string): void {
  updateSession(id, (x) => ({ ...x, title, customTitle: true }))
}

/** Claude's own title for the conversation, unless the user renamed the session. */
export function adoptTitle(sessionId: string, title: string): void {
  const clean = title.replace(/^[^\p{L}\p{N}]+/u, '').trim()
  const s = session(sessionId)
  if (!s || s.customTitle || !clean || clean === s.title || /^(claude( code)?|zsh|bash|fish|pwsh|powershell|cmd)$/i.test(clean)) return
  if (clean.includes('/') && !clean.includes(' ')) return // a path from the shell prompt
  updateSession(sessionId, (x) => ({ ...x, title: clean }))
}

export function move(delta: number): void {
  const list = orderedSessions()
  if (!list.length) return
  const i = list.findIndex((s) => s.id === store().ws.selectedSession)
  select(list[(i + delta + list.length) % list.length].id)
}

export function orderedSessions(): Session[] {
  const { projects, sessions } = store().ws
  return projects.flatMap((p) => sessions.filter((s) => s.projectId === p.id).sort((a, b) => a.createdAt - b.createdAt))
}

export function nextWaiting(): void {
  const list = orderedSessions()
  const i = list.findIndex((s) => s.id === store().ws.selectedSession)
  const rotated = [...list.slice(i + 1), ...list.slice(0, i + 1)]
  const hit = rotated.find((s) => sessionStatus(s, store().panes) === 'blocked') ??
    rotated.find((s) => store().unseen[s.id])
  if (hit) select(hit.id)
}

// Panes

/** The split directly holding a pane, if any. */
function parentSplit(l: Session['layout'], paneId: string): Extract<Session['layout'], { type: 'split' }> | undefined {
  if (l.type === 'pane') return undefined
  if (l.children.some((c) => c.type === 'pane' && c.paneId === paneId)) return l
  for (const c of l.children) {
    const hit = parentSplit(c, paneId)
    if (hit) return hit
  }
  return undefined
}

/** Gives every pane in the session an equal share again. */
export function evenOut(sessionId?: string): void {
  const s = session(sessionId) ?? selected()
  if (!s) return
  const even = (l: Session['layout']): Session['layout'] => (l.type === 'pane' ? l : { ...l, sizes: l.children.map(() => 1), children: l.children.map(even) })
  updateSession(s.id, (x) => ({ ...x, layout: even(x.layout) }))
}

/** Narrowest and shortest a pane may become by splitting; smaller ones can't show a usable terminal. */
const MIN_PANE = { row: 180, column: 110 }

export function split(dir: 'row' | 'column', kind: PaneKind = 'shell', extra: Partial<Pane> = {}, sessionId?: string): Pane | undefined {
  const s = session(sessionId) ?? selected()
  if (!s) return undefined
  // Splitting a pane that's already narrow would leave two unusable ones.
  const el = document.querySelector<HTMLElement>(`[data-pane="${s.focusedPane}"]`)
  if (el && s.id === store().ws.selectedSession) {
    // A split in the same direction shares its row equally (splitLayout); otherwise the pane halves.
    const parent = parentSplit(s.layout, s.focusedPane)
    const row = el.closest('.split')
    const size = (e: Element) => (dir === 'row' ? (e as HTMLElement).offsetWidth : (e as HTMLElement).offsetHeight)
    const room = parent?.dir === dir && row ? size(row) / (parent.children.length + 1) : size(el) / 2
    if (room < MIN_PANE[dir]) {
      toast(dir === 'row' ? 'Not enough room beside this pane. Split down, close a pane, or widen the window.' : 'Not enough room below this pane.')
      return undefined
    }
  }
  const pane = newPane(kind, extra)
  updateSession(s.id, (x) => ({
    ...x,
    panes: [...x.panes, pane],
    layout: splitLayout(x.layout, x.focusedPane, pane.id, dir),
    focusedPane: pane.id,
  }))
  return pane
}

export function updatePane(sessionId: string, paneId: string, patch: Partial<Pane>): void {
  updateSession(sessionId, (x) => ({ ...x, panes: x.panes.map((p) => (p.id === paneId ? { ...p, ...patch } : p)) }))
}

/** Opens a page in a browser pane beside the session's terminal: in `paneId`, the session's
 *  first browser pane, or a new one. Returns the pane. */
export function openBrowser(url: string, sessionId?: string, paneId?: string, newPane = false): string | undefined {
  const s = session(sessionId) ?? selected()
  if (!s) return undefined
  const existing = newPane ? undefined : s.panes.find((p) => p.kind === 'browser' && (!paneId || p.id === paneId))
  if (existing) {
    updatePane(s.id, existing.id, { url: normalizeUrl(url) })
    return existing.id
  }
  // Beside the terminal that asked, without taking focus from it.
  const focused = s.focusedPane
  const pane = split('row', 'browser', { url: normalizeUrl(url) }, s.id)
  if (pane) focusPane(s.id, focused)
  return pane?.id
}

export function focusPane(sessionId: string, paneId: string): void {
  if (session(sessionId)?.focusedPane !== paneId) updateSession(sessionId, (x) => ({ ...x, focusedPane: paneId }))
  seenPane(paneId)
}

/** The session a pane belongs to. */
export function sessionOfPane(paneId: string): Session | undefined {
  return store().ws.sessions.find((s) => s.panes.some((p) => p.id === paneId))
}

/** Whether you are looking at this pane right now. */
export function paneInView(paneId: string): boolean {
  const s = selected()
  return document.hasFocus() && !!s && s.focusedPane === paneId
}

/** You've looked at the pane: drop its ring and mark its notifications read. */
export function seenPane(paneId: string): void {
  if (store().panes[paneId]?.attention) store().setPane(paneId, { attention: false })
  if (store().notes.some((n) => n.paneId === paneId && !n.read))
    useStore.setState({ notes: store().notes.map((n) => (n.paneId === paneId ? { ...n, read: true } : n)) })
}

// Notifications

/** Records a notification; rings the pane and tells the OS when you aren't looking at it. */
export function addNote(sessionId: string, paneId: string | undefined, kind: Note['kind'], title: string, body: string): void {
  const inView = paneId ? paneInView(paneId) : document.hasFocus() && store().ws.selectedSession === sessionId
  const note: Note = { id: uid(), sessionId, paneId, kind, title, body, at: Date.now(), read: inView }
  useStore.setState({ notes: [...store().notes, note].slice(-200) })
  if (inView) return
  if (paneId) store().setPane(paneId, { attention: true })
  if (store().settings.notify) window.tz.notify(title, body, sessionId)
}

export function openNote(note: Note): void {
  select(note.sessionId)
  if (note.paneId && session(note.sessionId)?.panes.some((p) => p.id === note.paneId)) focusPane(note.sessionId, note.paneId)
  useStore.setState({ notes: store().notes.map((n) => (n.id === note.id ? { ...n, read: true } : n)) })
}

/** Jumps to the newest notification you haven't read. */
export function jumpToUnread(): void {
  const live = new Set(store().ws.sessions.map((s) => s.id))
  const note = [...store().notes].reverse().find((n) => !n.read && live.has(n.sessionId))
  if (note) openNote(note)
  else nextWaiting()
}

export function markAllRead(): void {
  useStore.setState({ notes: store().notes.map((n) => ({ ...n, read: true })) })
  for (const [id, p] of Object.entries(store().panes)) if (p.attention) store().setPane(id, { attention: false })
}

export function closePane(): void {
  const s = selected()
  if (s) closePaneById(s.id, s.focusedPane)
}

export function closePaneById(sessionId: string, paneId: string): void {
  const s = session(sessionId)
  if (!s) return
  if (s.panes.length <= 1) return closeSession(s.id)
  const layout = removeFromLayout(s.layout, paneId)!
  terms.dispose(paneId)
  updateSession(s.id, (x) => ({
    ...x,
    panes: x.panes.filter((p) => p.id !== paneId),
    layout,
    focusedPane: x.focusedPane === paneId ? layoutPanes(layout)[0] : x.focusedPane,
  }))
}

export function setSizes(sessionId: string, path: number[], sizes: number[]): void {
  updateSession(sessionId, (x) => {
    const set = (l: Session['layout'], depth: number): Session['layout'] => {
      if (l.type === 'pane') return l
      if (depth === path.length) return { ...l, sizes }
      return { ...l, children: l.children.map((c, i) => (i === path[depth] ? set(c, depth + 1) : c)) }
    }
    return { ...x, layout: set(x.layout, 0) }
  })
}

export async function restartPane(sessionId?: string, paneId?: string): Promise<void> {
  const s = session(sessionId) ?? selected()
  const pane = s?.panes.find((p) => p.id === (paneId ?? s.focusedPane))
  if (!s || !pane || pane.kind === 'browser') return
  const command = await startCommand(pane)
  terms.restart(pane.id, paneStart(s.id, pane.id, command))
}

/** Answers Claude Code's permission prompt: Return takes its default "Yes", Escape is "No". */
export function answer(sessionId: string | undefined, allow: boolean): void {
  const s = session(sessionId) ?? selected()
  if (!s) return
  const paneId = blockedPane(s, store().panes)
  if (paneId) terms.send(paneId, allow ? '\r' : '\x1b')
}

export function interrupt(): void {
  const s = selected()
  if (s) terms.send(s.focusedPane, '\x03')
}

/** Sends text to the session's Claude pane (or the focused one) as a prompt. */
export function sendToClaude(sessionId: string, text: string): void {
  const s = session(sessionId)
  if (!s) return
  const pane = s.panes.find((p) => p.kind === 'claude') ?? s.panes.find((p) => p.kind !== 'browser')
  if (!pane) return
  terms.paste(pane.id, text, true)
  focusPane(s.id, pane.id)
  terms.focus(pane.id)
}

export async function mergeWorktree(sessionId: string): Promise<void> {
  const s = session(sessionId)
  const p = project(s?.projectId)
  if (!s?.worktree || !p) return
  try {
    await window.tz.worktreeMerge(p.path, s.worktree)
    toast(`Merged ${s.worktree.branch} into ${s.worktree.base}.`)
  } catch (e) {
    toast(errorText(e))
  }
}

export function openConversation(id: string, cwd: string): void {
  const existing = store().ws.sessions.find((s) => s.panes.some((p) => p.claudeId === id))
  if (existing) return select(existing.id)
  const p = store().ws.projects.find((x) => x.path === cwd) ?? addProject(cwd)
  newSession(p.id, 'claude', undefined, id)
}

/** A browser beside the focused terminal: on the session's dev server if it runs one. */
export function openBrowserHere(): void {
  const s = selected()
  if (!s) return
  const port = store().meta[s.id]?.ports[0]
  const id = openBrowser(port ? `http://localhost:${port}` : 'about:blank', s.id)
  if (id) focusPane(s.id, id)
}

/** Opens a port one of the session's programs listens on. */
export function openPort(sessionId: string, port: number): void {
  select(sessionId)
  const id = openBrowser(`http://localhost:${port}`, sessionId)
  if (id) focusPane(sessionId, id)
}

// Layouts: a session's panes and splits, saved by name and opened as a new session.

export function saveLayout(sessionId?: string): void {
  const s = session(sessionId) ?? selected()
  if (!s) return
  store().setUI({
    prompt: {
      title: 'Save as layout',
      placeholder: 'Name, e.g. Claude + dev server',
      value: s.title,
      confirm: 'Save',
      onSubmit: (raw) => {
        const name = raw.trim()
        if (!name) return
        const index = new Map(s.panes.map((p, i) => [p.id, String(i)]))
        const map = (l: Session['layout']): Session['layout'] =>
          l.type === 'pane' ? { type: 'pane', paneId: index.get(l.paneId) ?? '0' } : { ...l, children: l.children.map(map) }
        const saved = {
          name,
          panes: s.panes.map((p) => ({ kind: p.kind, command: p.command, url: p.url })),
          layout: map(s.layout),
        }
        const rest = store().settings.layouts.filter((l) => l.name !== name)
        store().setSettings({ layouts: [...rest, saved] })
        toast(`Saved layout “${name}”.`)
      },
    },
  })
}

export function openLayout(name: string, projectId?: string): void {
  const saved = store().settings.layouts.find((l) => l.name === name)
  const p = project(projectId) ?? project(selected()?.projectId) ?? store().ws.projects[0]
  if (!saved || !p) return
  const panes = saved.panes.map((x) => newPane(x.kind, { command: x.command, url: x.url }))
  const map = (l: Session['layout']): Session['layout'] =>
    l.type === 'pane' ? { type: 'pane', paneId: panes[Number(l.paneId)]?.id ?? panes[0].id } : { ...l, children: l.children.map(map) }
  const s: Session = {
    id: uid(),
    projectId: p.id,
    title: uniqueTitle(p.id, saved.name),
    customTitle: true,
    panes,
    layout: map(saved.layout),
    focusedPane: panes[0].id,
    createdAt: Date.now(),
  }
  store().setWs((ws) => ({ ...ws, sessions: [...ws.sessions, s], selectedSession: s.id }))
}

export function deleteLayout(name: string): void {
  store().setSettings({ layouts: store().settings.layouts.filter((l) => l.name !== name) })
}

// Custom commands (Settings → Commands): run in a new pane beside the session.

export function runCustomCommand(name: string, sessionId?: string): boolean {
  const cmd = store().settings.commands.find((c) => c.name.toLowerCase() === name.toLowerCase())
  const s = session(sessionId) ?? selected()
  if (!cmd || !s) return false
  split('row', 'shell', { command: cmd.command }, s.id)
  return true
}

// Feedback

export function toast(message: string): void {
  store().setUI({ toast: message })
  setTimeout(() => {
    if (store().ui.toast === message) store().setUI({ toast: undefined })
  }, 4000)
}

export function errorText(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e)
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
