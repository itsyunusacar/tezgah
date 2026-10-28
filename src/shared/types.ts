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

/** What a pane holds: Claude Code, a shell, or a web page. */
export type PaneKind = 'claude' | 'shell' | 'browser'

/** One terminal inside a session. */
export interface Pane {
  id: string
  kind: PaneKind
  /** Claude Code conversation id, so the pane resumes the same conversation after a relaunch. */
  claudeId?: string
  /** Typed into the shell when it starts (custom commands, ssh…). */
  command?: string
  /** A browser pane's page. */
  url?: string
  /** An SSH session's target ("user@host"): dropped files are uploaded there. */
  ssh?: string
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
  /** Terminal font and colors: Tezgah's own, or the ones in your Ghostty config. */
  terminalLook: 'tezgah' | 'ghostty'
  /** Claude sessions get Tezgah's browser and pane tools (MCP, for sessions Tezgah starts). */
  agentTools: boolean
  /** Your own commands, in the palette and `tezgah run <name>`; each runs in a new pane. */
  commands: CustomCommand[]
}

/** Terminal colors in xterm.js's names. */
export type TerminalPalette = Partial<Record<
  'background' | 'foreground' | 'cursor' | 'selectionBackground' | 'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white' |
  'brightBlack' | 'brightRed' | 'brightGreen' | 'brightYellow' | 'brightBlue' | 'brightMagenta' | 'brightCyan' | 'brightWhite',
  string
>>

/** Font and colors read from another terminal's config. */
export interface TerminalLook {
  fontFamily?: string
  fontSize?: number
  light?: TerminalPalette
  dark?: TerminalPalette
}

export interface CustomCommand {
  name: string
  command: string
}

export const defaultSettings: Settings = { theme: 'system', fontSize: 13, claudeArgs: '', notify: true, commands: [], terminalLook: 'tezgah', agentTools: true }

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
  /** The conversation it belongs to. */
  claudeId: string
  type: string
  description: string
  /** Last tool it used: "Read src/app.tsx". */
  activity?: string
  running: boolean
  toolUses: number
  updatedAt: number
}

/** One step of an agent's transcript. */
export interface TranscriptEntry {
  kind: 'prompt' | 'text' | 'tool' | 'result' | 'error'
  text: string
  at?: number
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

export interface PullRequest {
  number: number
  url: string
  title: string
  state: 'open' | 'draft' | 'merged' | 'closed'
}

/** Live facts about a session's folder and processes, shown in the sidebar. */
export interface SessionMeta {
  branch?: string
  /** TCP ports its processes listen on, e.g. a dev server. */
  ports: number[]
  pr: PullRequest | null
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
  /** A shell pane's screen, kept across relaunches. */
  saveScrollback(paneId: string, data: string): void
  loadScrollback(paneId: string): Promise<string | null>
  dropScrollback(paneId: string): void
  ptyWrite(paneId: string, data: string): void
  ptyResize(paneId: string, cols: number, rows: number): void
  ptyKill(paneId: string): void
  onPtyData(cb: (paneId: string, data: string) => void): () => void
  onPtyExit(cb: (paneId: string, code: number) => void): () => void

  pickFolder(): Promise<string | undefined>
  claudeHasConversation(id: string): Promise<boolean>
  subagents(claudeId: string): Promise<SubAgent[]>
  agentTranscript(claudeId: string, agentId: string): Promise<TranscriptEntry[]>
  recentConversations(): Promise<RecentConversation[]>
  usage(): Promise<UsageLimit[] | null>
  ghosttyLook(): Promise<TerminalLook | null>
  /** Writes the MCP config that gives a Claude pane Tezgah's tools; returns its path. */
  mcpConfig(paneId: string): Promise<string>
  /** Drives a browser pane's page (snapshot, click, fill, screenshot…); see src/main/browser.ts. */
  browserAct(contentsId: number, action: string, args: Record<string, unknown>): Promise<unknown>

  sessionMeta(cwd: string, paneIds: string[]): Promise<SessionMeta>
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
  /** What a paste should insert: files copied in Finder/Explorer or an image (saved to a temp PNG) as paths, otherwise text. */
  clipboardPaste(): Promise<{ paths: string[]; text: string }>
  /** The browser's own paste, for text fields. */
  nativePaste(): void
  /** Copies files to `/tmp` on an SSH host; returns their remote paths. */
  scpUpload(target: string, files: string[]): Promise<string[]>
  /** A dropped file's path on disk. */
  pathForFile(file: File): string
  revealPath(path: string): void
  onOpenFolder(cb: (path: string) => void): () => void
  /** A request from the `tezgah` command. */
  onControl(cb: (id: string, req: { cmd: string; args: Record<string, unknown>; pane?: string; cwd?: string }) => void): () => void
  controlReply(id: string, res: { ok: boolean; result?: unknown; error?: string }): void
}
