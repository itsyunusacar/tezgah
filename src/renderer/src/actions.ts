import type { Pane, PaneKind, Project, Session } from '../../shared/types'
import {
  blockedPane, layoutPanes, newPane, removeFromLayout, sessionCwd, sessionStatus, splitLayout, store, uid, useStore,
} from './store'
import * as terms from './terminals'

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

export function split(dir: 'row' | 'column', kind: PaneKind = 'shell'): void {
  const s = selected()
  if (!s) return
  const pane = newPane(kind)
  updateSession(s.id, (x) => ({
    ...x,
    panes: [...x.panes, pane],
    layout: splitLayout(x.layout, x.focusedPane, pane.id, dir),
    focusedPane: pane.id,
  }))
}

export function focusPane(sessionId: string, paneId: string): void {
  if (session(sessionId)?.focusedPane !== paneId) updateSession(sessionId, (x) => ({ ...x, focusedPane: paneId }))
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
  if (!s || !pane) return
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
  const pane = s.panes.find((p) => p.kind === 'claude') ?? s.panes[0]
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
