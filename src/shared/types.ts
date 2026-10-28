// Types shared by the main process, the preload bridge and the renderer.

/** A folder you work in. Sessions live under it. */
export interface Project {
  id: string
  name: string
  path: string
  /** New sessions get their own git worktree by default. */
  worktrees: boolean
  collapsed?: boolean
}

/** What a pane runs when it starts. */
export type PaneKind = 'claude' | 'shell'

/** One terminal inside a session. */
export interface Pane {
  id: string
  kind: PaneKind
  /** Claude Code conversation id, so the pane resumes the same conversation after a relaunch. */
  claudeId?: string
}

/** Panes split horizontally (side by side) or vertically (stacked). */
export type Layout =
  | { type: 'pane'; paneId: string }
  | { type: 'split'; dir: 'row' | 'column'; children: Layout[]; sizes: number[] }

export interface Worktree {
  branch: string
  path: string
  base: string
}

/** A unit of work under a project: one or more panes, usually a Claude conversation. */
export interface Session {
  id: string
  projectId: string
  title: string
  /** Set when the user renamed it; otherwise the title follows Claude's. */
  customTitle?: boolean
  panes: Pane[]
  layout: Layout
  focusedPane: string
  worktree?: Worktree
  createdAt: number
}

export interface Workspace {
  projects: Project[]
  sessions: Session[]
  selectedSession?: string
}

export interface Settings {
  theme: 'system' | 'light' | 'dark'
  fontSize: number
  /** Extra arguments added to every `claude` start, e.g. "--model opus". */
  claudeArgs: string
  notify: boolean
}

export const defaultSettings: Settings = { theme: 'system', fontSize: 13, claudeArgs: '', notify: true }

// Live status, reported by Claude Code through OSC 7501.

export type AgentState = 'idle' | 'working' | 'done' | 'blocked' | 'error'

export interface StatusRecord {
  /** '' is the session itself; other ids are its subagents. */
  id: string
  state: AgentState
  kind?: 'permission' | 'question' | 'auth'
  title?: string
  message?: string
  app?: string
}

/** A subagent found in Claude Code's transcript folder. */
export interface SubAgent {
  id: string
  type: string
  description: string
  /** Last tool it used: "Read src/app.tsx". */
  activity?: string
  running: boolean
  toolUses: number
  updatedAt: number
}

export interface UsageLimit {
  label: string
  percent: number
  resetsAt?: number
}

export interface FileChange {
  path: string
  status: 'M' | 'A' | 'D' | 'R' | 'U'
  added: number
  removed: number
}

export interface Diff {
  files: FileChange[]
  /** Unified diff per file path. */
  patches: Record<string, string>
  against: string
}

export interface RecentConversation {
  id: string
  cwd: string
  prompt: string
  updatedAt: number
}

/** The API the preload script exposes as `window.tz`. */
export interface Api {
  platform: NodeJS.Platform
  load(): Promise<{ workspace: Workspace; settings: Settings }>
  saveWorkspace(ws: Workspace): void
  saveSettings(s: Settings): void

  /** `light`: the terminal has a light background (told to programs through COLORFGBG). */
  ptyStart(opts: { paneId: string; cwd: string; command?: string; cols: number; rows: number; light?: boolean }): Promise<void>
  ptyWrite(paneId: string, data: string): void
  ptyResize(paneId: string, cols: number, rows: number): void
  ptyKill(paneId: string): void
  onPtyData(cb: (paneId: string, data: string) => void): () => void
  onPtyExit(cb: (paneId: string, code: number) => void): () => void

  pickFolder(): Promise<string | undefined>
  claudeHasConversation(id: string): Promise<boolean>
  subagents(claudeId: string): Promise<SubAgent[]>
  recentConversations(): Promise<RecentConversation[]>
  usage(): Promise<UsageLimit[] | null>

  diff(cwd: string, base?: string): Promise<Diff | null>
  isGitRepo(cwd: string): Promise<boolean>
  worktreeAdd(repo: string, branch: string): Promise<Worktree>
  worktreeRemove(repo: string, wt: Worktree, deleteBranch: boolean): Promise<void>
  worktreeMerge(repo: string, wt: Worktree): Promise<string>

  setBadge(count: number): void
  notify(title: string, body: string, sessionId: string): void
  onNotificationClick(cb: (sessionId: string) => void): () => void
  onMenu(cb: (action: string) => void): () => void
  openExternal(url: string): void
  revealPath(path: string): void
  onOpenFolder(cb: (path: string) => void): () => void
}
