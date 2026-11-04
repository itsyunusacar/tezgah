import { plural, t } from '../../shared/i18n'
import { create } from 'zustand'
import type {
  AgentState, Pane, PaneKind, ProviderUsage, Project, Session, SessionMeta, Settings, StatusRecord, SubAgent, Workspace,
} from '../../shared/types'
import { defaultSettings } from '../../shared/types'

export const uid = () => crypto.randomUUID()

/** Live, unsaved state of one pane. */
export interface PaneRuntime {
  records: StatusRecord[]
  title: string
  exited: boolean
  /** Output arrived while the pane wasn't on screen. */
  activity: boolean
  /** Finished, asked for you or sent a notification while you were looking elsewhere: draws a ring. */
  attention: boolean
}

/** One entry in the notification panel. */
export interface Note {
  id: string
  sessionId: string
  paneId?: string
  title: string
  body: string
  kind: 'blocked' | 'done' | 'notice'
  at: number
  read: boolean
}

/** The state a session shows: the most urgent of its panes. */
export type SessionStatus = AgentState | 'exited' | undefined

interface UI {
  sidebar: boolean
  changes: boolean
  palette: boolean
  recent: boolean
  settings: boolean
  /** The notification panel. */
  inbox: boolean
  /** The first-run tour. */
  intro?: boolean
  /** The keyboard shortcut editor. */
  shortcuts?: boolean
  /** The subagent whose transcript is open. */
  agent?: { claudeId: string; id: string }
  /** The pane whose find bar is open. */
  find?: string
  /** Choosing what a screen pane shows. */
  screenPicker?: { sessionId: string; paneId: string }
  /** A small prompt dialog (rename, branch name…). */
  prompt?: { title: string; placeholder?: string; value: string; confirm: string; onSubmit: (v: string) => void }
  confirm?: { title: string; body: string; actions: { label: string; danger?: boolean; run: () => void }[] }
  toast?: string
}

interface State {
  ready: boolean
  ws: Workspace
  settings: Settings
  panes: Record<string, PaneRuntime>
  agents: Record<string, SubAgent[]>
  usage: ProviderUsage[]
  /** Sessions whose "done" you haven't looked at yet. */
  unseen: Record<string, boolean>
  /** Newest last. */
  notes: Note[]
  meta: Record<string, SessionMeta>
  /** Tezgah's version, for the sidebar's signature. */
  version: string
  /** The user's home folder, where a shell opens when there's no project. */
  home: string
  /** A newer release, when there is one. */
  update: { version: string; url: string; ready: boolean } | null
  ui: UI

  setWs(fn: (ws: Workspace) => Workspace): void
  setSettings(patch: Partial<Settings>): void
  setUI(patch: Partial<UI>): void
  setPane(id: string, patch: Partial<PaneRuntime> | ((p: PaneRuntime) => Partial<PaneRuntime>)): void
}

const emptyPane = (): PaneRuntime => ({ records: [], title: '', exited: false, activity: false, attention: false })

export const useStore = create<State>((set) => ({
  ready: false,
  ws: { projects: [], sessions: [] },
  settings: defaultSettings,
  panes: {},
  agents: {},
  usage: [],
  unseen: {},
  notes: [],
  meta: {},
  version: '',
  home: '',
  update: null,
  ui: { sidebar: true, changes: false, palette: false, recent: false, settings: false, inbox: false },

  setWs: (fn) =>
    set((s) => {
      const ws = fn(s.ws)
      saveSoon()
      return { ws }
    }),
  setSettings: (patch) =>
    set((s) => {
      const settings = { ...s.settings, ...patch }
      window.tz.saveSettings(settings)
      return { settings }
    }),
  setUI: (patch) => set((s) => ({ ui: { ...s.ui, ...patch } })),
  setPane: (id, patch) =>
    set((s) => {
      const cur = s.panes[id] ?? emptyPane()
      const next = { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) }
      return { panes: { ...s.panes, [id]: next } }
    }),
}))

export const store = () => useStore.getState()

// The workspace is written a moment after it last changed (a drag or a burst of status updates
// is one write), and at once when the window closes.
let saveTimer: ReturnType<typeof setTimeout> | undefined

function saveSoon(): void {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => flushWorkspace(), 300)
}

/** Writes the workspace now if a save is pending; `sync` blocks until it's on disk (quitting). */
export function flushWorkspace(sync = false): void {
  if (saveTimer === undefined) return
  clearTimeout(saveTimer)
  saveTimer = undefined
  window.tz.saveWorkspace(store().ws, sync)
}

// Derived state

/** A dialog or panel covers the window (browser pages hide under it; focus goes back to a pane after). */
export function overlayOpen(ui: UI): boolean {
  return !!(ui.palette || ui.recent || ui.settings || ui.inbox || ui.prompt || ui.confirm || ui.agent || ui.shortcuts || ui.intro || ui.screenPicker)
}

export function rootRecord(p?: PaneRuntime): StatusRecord | undefined {
  return p?.records.find((r) => r.id === '')
}

const urgency: Record<string, number> = { blocked: 5, error: 4, working: 3, done: 2, idle: 1, exited: 0 }

export function sessionStatus(session: Session, panes: Record<string, PaneRuntime>): SessionStatus {
  let best: SessionStatus
  for (const pane of session.panes) {
    const rt = panes[pane.id]
    const s: SessionStatus = rt?.exited ? 'exited' : rootRecord(rt)?.state
    if (s && (best === undefined || urgency[s] > urgency[best])) best = s
  }
  return best
}

/** The blocked Claude pane of a session, if any (the one Allow / Deny answers). */
export function blockedPane(session: Session, panes: Record<string, PaneRuntime>): string | undefined {
  return session.panes.find((p) => rootRecord(panes[p.id])?.state === 'blocked')?.id
}

export function statusLine(session: Session, panes: Record<string, PaneRuntime>, agents: SubAgent[] = []): string {
  const status = sessionStatus(session, panes)
  const pane = session.panes.find((p) => rootRecord(panes[p.id])?.state === status) ?? session.panes[0]
  const rec = rootRecord(panes[pane?.id])
  const running = agents.filter((a) => a.running).length
  const tail = running ? ` · ${plural(running, '{n} agent', '{n} agents')}` : ''
  switch (status) {
    case 'blocked':
      return `${t('Needs you')}${rec?.message ? ' · ' + rec.message : rec?.kind ? ' · ' + t(rec.kind) : ''}`
    case 'working':
      return `${t('Working')}${rec?.message ? ' · ' + rec.message : '…'}${tail}`
    case 'done':
      return t('Done')
    case 'error':
      return `${t('Error')}${rec?.message ? ' · ' + rec.message : ''}`
    case 'exited':
      return t('Stopped')
    default:
      return ''
  }
}

// Session order

/** A project's sessions as the sidebar lists them: pinned first, then in order; archived ones apart. */
export function sessionsOf(ws: Workspace, projectId: string, archived = false): Session[] {
  return ws.sessions
    .filter((s) => s.projectId === projectId && !!s.archived === archived)
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || a.createdAt - b.createdAt)
}

/** The project id of terminals that belong to no project (Terminals, at the top of the sidebar): shells
 *  that open in your home folder, for a quick command. */
export const TERMINALS = ''

export const isTerminal = (s: Session) => s.projectId === TERMINALS

/** Every session the sidebar shows, top to bottom: terminals, then each project's. */
export function visibleSessions(ws: Workspace): Session[] {
  return [...sessionsOf(ws, TERMINALS), ...ws.projects.flatMap((p) => sessionsOf(ws, p.id))]
}

/** Shells that used to open in the home folder as a project ("~"), before Terminals: they move there, and
 *  the project goes once nothing else is in it. Claude sessions and worktrees stay a project's. */
export function migrateHome(ws: Workspace, home: string): Workspace {
  const p = home ? ws.projects.find((x) => x.path === home) : undefined
  if (!p) return ws
  const moves = (s: Session) => s.projectId === p.id && !s.worktree && s.panes.every((x) => x.kind !== 'claude')
  if (!ws.sessions.some(moves)) return ws
  const sessions = ws.sessions.map((s) => (moves(s) ? { ...s, projectId: TERMINALS } : s))
  const empty = !sessions.some((s) => s.projectId === p.id)
  return { ...ws, sessions, projects: empty ? ws.projects.filter((x) => x !== p) : ws.projects }
}

/** What to select once `id` is closed or archived: the session below it in the sidebar, else the one above. */
export function nextSelection(ws: Workspace, id: string): string | undefined {
  if (ws.selectedSession !== id) return ws.selectedSession
  const list = visibleSessions(ws)
  const i = list.findIndex((s) => s.id === id)
  return i < 0 ? undefined : (list[i + 1] ?? list[i - 1])?.id
}

/** The agent whose plan limits the sidebar shows for a session: the one in its focused pane, else
 *  any pane's, else Claude (what most sessions run). */
export function limitsFor(session: Session | undefined, panes: Record<string, PaneRuntime>): string {
  if (!session) return 'claude'
  const agent = (p: Pane) => (p.kind === 'claude' ? 'claude' : panes[p.id]?.exited ? undefined : rootRecord(panes[p.id])?.app)
  const focused = session.panes.find((p) => p.id === session.focusedPane)
  return (focused && agent(focused)) ?? session.panes.map(agent).find(Boolean) ?? 'claude'
}

/** Whether an agent runs in the pane (Claude, or one that reports or was recognized), so keys like
 *  Shift+Enter mean what they do there rather than what a shell or vim expects. */
export function agentPane(kind: PaneKind | undefined, rt: PaneRuntime | undefined): boolean {
  if (rt?.exited) return false
  return kind === 'claude' || !!rootRecord(rt)?.app
}

// Layout helpers (the tree itself: layout.ts)

export { layoutPanes, removeFromLayout, splitLayout } from './layout'

export function newPane(kind: PaneKind, extra: Partial<Pane> = {}): Pane {
  return kind === 'claude' ? { id: uid(), kind, claudeId: uid(), ...extra } : { id: uid(), kind, ...extra }
}

/** Where a session's programs start: its worktree, its project, or (a terminal) the home folder. */
export function sessionCwd(session: Session, project?: Project): string {
  return session.worktree?.path ?? project?.path ?? (isTerminal(session) ? useStore.getState().home : '')
}
