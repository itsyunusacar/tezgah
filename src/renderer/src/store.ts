import { create } from 'zustand'
import type {
  AgentState, Layout, Pane, PaneKind, ProviderUsage, Project, Session, SessionMeta, Settings, StatusRecord, SubAgent, Workspace,
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
  /** The subagent whose transcript is open. */
  agent?: { claudeId: string; id: string }
  /** The pane whose find bar is open. */
  find?: string
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
  ui: { sidebar: true, changes: false, palette: false, recent: false, settings: false, inbox: false },

  setWs: (fn) =>
    set((s) => {
      const ws = fn(s.ws)
      window.tz.saveWorkspace(ws)
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

// Derived state

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
  const tail = running ? ` · ${running} agent${running > 1 ? 's' : ''}` : ''
  switch (status) {
    case 'blocked':
      return `Needs you${rec?.message ? ' · ' + rec.message : rec?.kind ? ' · ' + rec.kind : ''}`
    case 'working':
      return `Working${rec?.message ? ' · ' + rec.message : '…'}${tail}`
    case 'done':
      return 'Done'
    case 'error':
      return `Error${rec?.message ? ' · ' + rec.message : ''}`
    case 'exited':
      return 'Stopped'
    default:
      return ''
  }
}

// Layout helpers

export function layoutPanes(l: Layout): string[] {
  return l.type === 'pane' ? [l.paneId] : l.children.flatMap(layoutPanes)
}

/** Splits `target` in `dir`, putting `newId` after it. */
export function splitLayout(l: Layout, target: string, newId: string, dir: 'row' | 'column'): Layout {
  if (l.type === 'pane') {
    if (l.paneId !== target) return l
    return { type: 'split', dir, children: [l, { type: 'pane', paneId: newId }], sizes: [1, 1] }
  }
  const i = l.children.findIndex((c) => c.type === 'pane' && c.paneId === target)
  if (i >= 0 && l.dir === dir) {
    const children = [...l.children]
    children.splice(i + 1, 0, { type: 'pane', paneId: newId })
    // Everything in the row (or column) shares the space equally, so repeated splits don't shrink one corner.
    return { ...l, children, sizes: children.map(() => 1) }
  }
  return { ...l, children: l.children.map((c) => splitLayout(c, target, newId, dir)) }
}

export function removeFromLayout(l: Layout, paneId: string): Layout | undefined {
  if (l.type === 'pane') return l.paneId === paneId ? undefined : l
  const kept: Layout[] = []
  const sizes: number[] = []
  l.children.forEach((c, i) => {
    const next = removeFromLayout(c, paneId)
    if (next) {
      kept.push(next)
      sizes.push(l.sizes[i])
    }
  })
  if (kept.length === 0) return undefined
  if (kept.length === 1) return kept[0]
  return { ...l, children: kept, sizes }
}

export function newPane(kind: PaneKind, extra: Partial<Pane> = {}): Pane {
  return kind === 'claude' ? { id: uid(), kind, claudeId: uid(), ...extra } : { id: uid(), kind, ...extra }
}

export function sessionCwd(session: Session, project?: Project): string {
  return session.worktree?.path ?? project?.path ?? ''
}
