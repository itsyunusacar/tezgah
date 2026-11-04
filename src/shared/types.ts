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

/** What a pane holds: Claude Code, a shell, a web page, or a live view of a window or screen. */
export type PaneKind = 'claude' | 'shell' | 'browser' | 'screen'

/** The window or display a screen pane shows, remembered by name to find again after a relaunch. */
export interface ScreenSource {
  /** desktopCapturer's id; good while the window lives. */
  id?: string
  kind: 'window' | 'screen'
  /** Its title (or the display's name). */
  name: string
  /** The app that owns the window (macOS). */
  app?: string
}

/** A window or display that can be shown, as the picker lists it. */
export interface ScreenSourceInfo extends ScreenSource {
  id: string
  /** Data URLs. */
  thumbnail?: string
  icon?: string
  /** Its app can be brought to the front. */
  canShow: boolean
}

/** Whether Tezgah may record the screen (macOS asks; elsewhere always yes). */
export type ScreenAccess = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown'

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
  /** A screen pane's window or display. */
  screen?: ScreenSource
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
  /** Order within its project; drag to change. */
  createdAt: number
  /** Kept at the top of its project. */
  pinned?: boolean
  /** Put away: its programs are stopped, its conversation kept to resume. */
  archived?: boolean
}

export interface Workspace {
  projects: Project[]
  sessions: Session[]
  selectedSession?: string
}

export interface Settings {
  theme: 'system' | 'light' | 'dark'
  /** Interface language; "system" follows the OS. */
  language: 'system' | 'tr' | 'en'
  fontSize: number
  /** Extra arguments added to every `claude` start, e.g. "--model opus". */
  claudeArgs: string
  notify: boolean
  /** Terminal font and colors: Tezgah's own, or the ones in your Ghostty config. */
  terminalLook: 'tezgah' | 'ghostty'
  /** Claude sessions get Tezgah's browser and pane tools (MCP, for sessions Tezgah starts). */
  agentTools: boolean
  /** `tezgah` and agents' tools may type into, read and drive panes of other sessions, not only their own. */
  otherSessions: boolean
  layouts: SavedLayout[]
  /** What a folder opened from Finder, Explorer or the command line starts with. */
  folderStarts: 'claude' | 'shell'
  /** macOS: "Open in Tezgah" in Finder's Quick Actions for folders. */
  finderAction: boolean
  /** The first-run tour has been seen (or skipped). */
  introSeen: boolean
  /** Your own keyboard shortcuts, by command ("" turns one off). */
  shortcuts: Record<string, string>
  /** Look for a newer Tezgah on GitHub now and then. */
  checkUpdates: boolean
  /** Download new versions and install them when you quit, where this copy can replace itself. */
  installUpdates: boolean
  /** Agents whose limits you don't want in the sidebar. */
  hiddenUsage: string[]
  /** Your own commands, in the palette and `tezgah run <name>`; each runs in a new pane. */
  commands: CustomCommand[]
  /** Where new browser and screen panes open: beside the terminal (row) or below it (column), as you last put one. */
  paneSides: Partial<Record<'browser' | 'screen', 'row' | 'column'>>
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

/** A session's panes and how they're split, saved to open again: "Claude + dev server + browser". */
export interface SavedLayout {
  name: string
  panes: { kind: PaneKind; command?: string; url?: string; screen?: ScreenSource }[]
  /** The split tree; each pane's id is its index in `panes`. */
  layout: Layout
}

export interface CustomCommand {
  name: string
  command: string
}

export const defaultSettings: Settings = { theme: 'system', language: 'system', fontSize: 13, claudeArgs: '', notify: true, commands: [], terminalLook: 'tezgah', agentTools: true, otherSessions: false, hiddenUsage: [], layouts: [], checkUpdates: true, installUpdates: true, shortcuts: {}, introSeen: false, folderStarts: 'claude', finderAction: true, paneSides: {} }

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

/** Token use of a Claude conversation, from its transcript. */
export interface ConversationStats {
  /** Tokens sent to the model over the conversation, cached ones included. */
  input: number
  output: number
  cacheRead: number
  /** Tokens in the context at the last turn. */
  context: number
  messages: number
  model?: string
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
  windowMinutes?: number
}

/** Agents whose plan limits Tezgah knows about, and whether it can read them. */
export const usageProviders: { id: string; name: string; unavailable?: string }[] = [
  { id: 'claude', name: 'Claude' },
  { id: 'codex', name: 'Codex' },
  { id: 'gemini', name: 'Gemini', unavailable: "Gemini doesn't keep its limits on your computer" },
  { id: 'grok', name: 'Grok', unavailable: "Grok doesn't keep its limits on your computer" },
]

/** What the menu bar icon lists: every session, most urgent first. */
export interface TrayState {
  sessions: { id: string; title: string; project?: string; status?: string; line?: string; unseen?: boolean }[]
}

/** One agent's plan limits. */
export interface ProviderUsage {
  id: 'claude' | 'codex'
  name: string
  /** "Max", "Team", "Plus", "Go"… */
  plan?: string
  limits: UsageLimit[]
  /** When these numbers were true. */
  asOf: number
  /** Fetched just now (Claude), or the agent's last report (Codex: from its most recent run). */
  live: boolean
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
  load(): Promise<{ workspace: Workspace; settings: Settings; version: string; home: string }>
  /** `sync`: block until it's written (the window is closing). */
  saveWorkspace(ws: Workspace, sync?: boolean): void
  saveSettings(s: Settings): void

  /** `light`: the terminal has a light background (told to programs through COLORFGBG). */
  ptyStart(opts: { paneId: string; cwd: string; command?: string; cols: number; rows: number; light?: boolean }): Promise<void>
  /** A shell pane's screen, kept across relaunches. `sync`: block until it's written (the window is closing). */
  saveScrollback(paneId: string, data: string, sync?: boolean): void
  loadScrollback(paneId: string): Promise<string | null>
  dropScrollback(paneId: string): void
  ptyWrite(paneId: string, data: string): void
  ptyResize(paneId: string, cols: number, rows: number): void
  ptyKill(paneId: string): void
  /** The program running in a terminal's foreground other than its shell ("top", "npm"), or null at a prompt. */
  ptyForeground(paneId: string): Promise<string | null>
  onPtyData(cb: (paneId: string, data: string) => void): () => void
  onPtyExit(cb: (paneId: string, code: number) => void): () => void
  /** The coding agent now in a terminal's foreground (Grok, Gemini, Codex…), or null when it leaves. */
  onPtyAgent(cb: (paneId: string, agent: string | null) => void): () => void

  pickFolder(): Promise<string | undefined>
  claudeHasConversation(id: string): Promise<boolean>
  subagents(claudeId: string): Promise<SubAgent[]>
  agentTranscript(claudeId: string, agentId: string): Promise<TranscriptEntry[]>
  conversationStats(claudeId: string): Promise<ConversationStats | null>
  recentConversations(): Promise<RecentConversation[]>
  usage(): Promise<ProviderUsage[]>
  /** Versions of claude, git and gh when installed, for the welcome checklist. */
  tools(): Promise<{ claude?: string; git?: string; gh?: string; signedIn: boolean }>
  /** A newer Tezgah release on GitHub, if there is one; with `install`, it is downloaded to install on quit. */
  checkUpdate(install: boolean): Promise<{ version: string; url: string; ready: boolean } | null>
  /** The downloaded update is ready to install (its version). */
  onUpdateReady(cb: (version: string) => void): () => void
  /** Whether this copy can replace itself (not a dev build, a .deb or a folder you can't write to). */
  canInstallUpdates(): Promise<boolean>
  /** Quits, installs the downloaded update and opens Tezgah again. */
  installUpdate(): void
  ghosttyLook(): Promise<TerminalLook | null>
  /** Writes the MCP config that gives a Claude pane Tezgah's tools; returns its path. */
  mcpConfig(paneId: string): Promise<string>
  /** Screen panes: may Tezgah record the screen, what's there to show (`ask`: may put up macOS's question),
   *  its app to the front, and macOS's Screen Recording settings. */
  screenAccess(): Promise<ScreenAccess>
  screenSources(thumbnails: boolean, ask?: boolean): Promise<ScreenSourceInfo[]>
  showScreenApp(id: string): Promise<boolean>
  openScreenSettings(): void
  /** Drives a browser pane's page (snapshot, click, fill, screenshot…); see src/main/browser.ts. */
  browserAct(contentsId: number, action: string, args: Record<string, unknown>): Promise<unknown>

  sessionMeta(cwd: string, paneIds: string[]): Promise<SessionMeta>
  diff(cwd: string, base?: string): Promise<Diff | null>
  isGitRepo(cwd: string): Promise<boolean>
  gitStatus(cwd: string): Promise<{ branch: string; dirty: boolean; ahead: number | null; remote: boolean; defaultBranch?: string } | null>
  /** Stages everything and commits; returns the short hash. */
  gitCommit(cwd: string, message: string): Promise<string>
  gitPush(cwd: string): Promise<void>
  /** `gh pr create --fill`; returns the pull request's URL. */
  gitCreatePr(cwd: string): Promise<string>
  worktreeAdd(repo: string, branch: string): Promise<Worktree>
  worktreeRemove(repo: string, wt: Worktree, deleteBranch: boolean): Promise<void>
  worktreeMerge(repo: string, wt: Worktree): Promise<string>

  setBadge(count: number): void
  /** Turns the menu's shortcuts off while you record a new one. */
  suspendMenu(suspended: boolean): void
  updateTray(state: TrayState): void
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
  /** Tezgah was asked to open something: a folder (Finder, Explorer, the command line), a script or command, an ssh:// link. */
  onOpen(cb: (req: { kind: 'folder'; path: string } | { kind: 'run'; cwd: string; command: string } | { kind: 'ssh'; target: string }) => void): () => void
  /** Whether Tezgah is the system's terminal for scripts and ssh:// links (macOS) or GNOME's default terminal. */
  defaultTerminal(): Promise<{ supported: false } | { supported: true; isDefault: boolean }>
  makeDefaultTerminal(): Promise<{ supported: false } | { supported: true; isDefault: boolean }>
  /** Whether this copy puts "Open in Tezgah" in Finder (an installed app on macOS). */
  finderActionSupported(): Promise<boolean>
  /** A request from the `tezgah` command. */
  onControl(cb: (id: string, req: { cmd: string; args: Record<string, unknown>; pane?: string; cwd?: string }) => void): () => void
  controlReply(id: string, res: { ok: boolean; result?: unknown; error?: string }): void
}
