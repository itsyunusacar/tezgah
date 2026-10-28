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

/** What a pane runs at start: a Claude conversation it can resume, or just the shell. */
export async function startCommand(pane: Pane): Promise<string | undefined> {
  if (pane.kind === 'shell') return pane.command
  if (pane.kind !== 'claude' || !pane.claudeId) return undefined
  const exists = await window.tz.claudeHasConversation(pane.claudeId)
  const extra = store().settings.claudeArgs.trim()
  return `claude ${exists ? '--resume' : '--session-id'} ${pane.claudeId}${extra ? ' ' + extra : ''}`
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

export function newSession(projectId: string | undefined, kind: PaneKind, worktree?: Session['worktree'], claudeId?: string): Session | undefined {
  const p = project(projectId) ?? store().ws.projects[0]
  if (!p) {
    openFolder()
    return undefined
  }
  const pane = newPane(kind)
  if (claudeId) pane.claudeId = claudeId
  const count = store().ws.sessions.filter((s) => s.projectId === p.id).length
  const s: Session = {
    id: uid(),
    projectId: p.id,
    title: worktree ? worktree.branch : kind === 'claude' ? 'New session' : 'Shell',
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

export function split(dir: 'row' | 'column', kind: PaneKind = 'shell', extra: Partial<Pane> = {}, sessionId?: string): Pane | undefined {
  const s = session(sessionId) ?? selected()
  if (!s) return undefined
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

/** Opens a page in a browser pane beside the session's terminal, reusing one that's already open. */
export function openBrowser(url: string, sessionId?: string): void {
  const s = session(sessionId) ?? selected()
  if (!s) return
  select(s.id)
  const existing = s.panes.find((p) => p.kind === 'browser')
  if (existing) {
    updatePane(s.id, existing.id, { url: normalizeUrl(url) })
    focusPane(s.id, existing.id)
    return
  }
  split('row', 'browser', { url: normalizeUrl(url) }, s.id)
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
  if (!s) return
  if (s.panes.length <= 1) return closeSession(s.id)
  const layout = removeFromLayout(s.layout, s.focusedPane)!
  terms.dispose(s.focusedPane)
  updateSession(s.id, (x) => ({
    ...x,
    panes: x.panes.filter((p) => p.id !== x.focusedPane),
    layout,
    focusedPane: layoutPanes(layout)[0],
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
  openBrowser(port ? `http://localhost:${port}` : 'about:blank', s.id)
}

/** Opens a port one of the session's programs listens on. */
export function openPort(sessionId: string, port: number): void {
  openBrowser(`http://localhost:${port}`, sessionId)
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
