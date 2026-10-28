import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, Notification, shell } from 'electron'
import os from 'node:os'
import { execFile } from 'node:child_process'
import type { MenuItemConstructorOptions } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as pty from './pty'
import * as claude from './claude'
import * as git from './git'
import * as meta from './meta'
import { mcpConfigFile, startControl } from './control'
import { ghosttyLook } from './ghostty'
import * as browser from './browser'
import { allUsage } from './usage'
import * as defaultTerminal from './default-terminal'
import * as updates from './updates'
import { createTray, refreshTray, updateTray } from './tray'
import { language, resolveLanguage, setLanguage, t } from '../shared/i18n'
import { defaultSettings, type Settings, type Workspace } from '../shared/types'
import { accelerator, gotoAccelerator, setOverrides, type Command } from '../shared/shortcuts'

const isMac = process.platform === 'darwin'
let win: BrowserWindow | null = null
/** The shortcuts the menu was last built with. */
let lastShortcuts = '{}'


// Persistence: two small JSON files in the user data folder, written atomically.

const dataDir = () => app.getPath('userData')
const file = (name: string) => path.join(dataDir(), name)

function readJson<T>(name: string, fallback: T): T {
  for (const candidate of [name, `${name}.bak`]) {
    try {
      return { ...fallback, ...JSON.parse(fs.readFileSync(file(candidate), 'utf8')) }
    } catch {
      // Missing or corrupt; try the backup.
    }
  }
  return fallback
}

function writeJson(name: string, value: unknown): void {
  fs.mkdirSync(dataDir(), { recursive: true })
  const target = file(name)
  const tmp = `${target}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2))
  if (fs.existsSync(target)) fs.copyFileSync(target, `${target}.bak`)
  fs.renameSync(tmp, target)
}

// Window

function createWindow(): void {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 760,
    minHeight: 480,
    show: false,
    title: 'Tezgah',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0E0D0C' : '#FDFCFC',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 16, y: 16 },
    titleBarOverlay: isMac ? undefined : { color: '#00000000', symbolColor: '#777169', height: 40 },
    icon: isMac ? undefined : path.join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      webviewTag: true,
    },
  })
  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => {
    win = null
    pty.killAll()
  })
  // Links open in the browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))

  win.webContents.on('did-finish-load', () => {
    for (const req of pending.splice(0)) win?.webContents.send('open', req)
  })
}

/** Something to open: a folder (as a project), a script or command to run, or an SSH target. */
export type OpenRequest = { kind: 'folder'; path: string } | { kind: 'run'; cwd: string; command: string } | { kind: 'ssh'; target: string }

/** Requests that arrived before the window was ready. */
const pending: OpenRequest[] = []

function deliver(req: OpenRequest): void {
  if (win && !win.webContents.isLoading()) win.webContents.send('open', req)
  else pending.push(req)
  win?.show()
  win?.focus()
}

const SCRIPT = /\.(command|tool|sh|bash|zsh|fish)$/i
const quoteArg = (p: string) => (process.platform === 'win32' ? `& "${p}"` : `'${p.replace(/'/g, `'\\''`)}'`)

/** A folder opens as a project; a script runs in a new shell session beside it; any other file opens its folder. */
function openPath(p: string): void {
  let stat: fs.Stats
  try {
    stat = fs.statSync(p)
  } catch {
    return
  }
  if (stat.isDirectory()) return deliver({ kind: 'folder', path: p })
  const executable = process.platform !== 'win32' && (stat.mode & 0o111) !== 0
  if (SCRIPT.test(p) || executable) return deliver({ kind: 'run', cwd: path.dirname(p), command: quoteArg(p) })
  deliver({ kind: 'folder', path: path.dirname(p) })
}

/** ssh://user@host:port, from a link or the system's default terminal handler. */
function openUrl(url: string): void {
  try {
    const u = new URL(url)
    if (u.protocol !== 'ssh:' || !u.hostname) return
    const target = `${u.username ? decodeURIComponent(u.username) + '@' : ''}${u.hostname}`
    deliver({ kind: 'ssh', target: u.port ? `${target} -p ${u.port}` : target })
  } catch {
    // Not a URL we handle.
  }
}

/** What the command line asks for: folders and files (`tezgah ~/code/app`), or a command to run the way
 *  terminals are asked to (`-e cmd…` by x-terminal-emulator, `-x cmd…` by GNOME), in the current folder. */
function requestsIn(argv: string[], cwd = process.cwd()): OpenRequest[] {
  const args = argv.slice(app.isPackaged ? 1 : 2)
  const out: OpenRequest[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '-e' || a === '-x' || a === '--command') {
      const rest = args.slice(i + 1)
      if (rest.length) out.push({ kind: 'run', cwd, command: rest.join(' ') })
      break
    }
    if (a.startsWith('ssh://')) {
      openUrl(a)
      continue
    }
    if (a.startsWith('-')) continue
    const p = path.resolve(cwd, a)
    if (fs.existsSync(p)) out.push(fs.statSync(p).isDirectory() ? { kind: 'folder', path: p } : { kind: 'folder', path: path.dirname(p) })
  }
  return out
}

// Menu: every command is also a keyboard shortcut; the renderer does the work.

function buildMenu(): void {
  const send = (action: string) => () => win?.webContents.send('menu', action)
  const item = (label: string, cmd: Command, action: string = cmd): MenuItemConstructorOptions => ({
    label,
    accelerator: accelerator(cmd, isMac),
    click: send(action),
  })
  const role = (r: MenuItemConstructorOptions['role'], cmd: Command): MenuItemConstructorOptions => ({ role: r, accelerator: accelerator(cmd, isMac) })
  const sep: MenuItemConstructorOptions = { type: 'separator' }
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: 'Tezgah',
          submenu: [
            { role: 'about' }, sep, item(t('Settings…'), 'settings'), sep,
            { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, sep, { role: 'quit' },
          ],
        } as MenuItemConstructorOptions]
      : []),
    {
      label: t('File'),
      submenu: [
        item(t('New Claude Session'), 'new-claude'),
        item(t('New Shell Session'), 'new-shell'),
        item(t('New Session in a Worktree…'), 'new-worktree'),
        sep,
        item(t('Open Folder…'), 'open-folder'),
        item(t('Recent Conversations…'), 'recent'),
        sep,
        item(t('Close Pane'), 'close-pane'),
        item(t('Close Session'), 'close-session'),
        ...(isMac ? [] : [sep, item(t('Settings…'), 'settings'), sep, { role: 'quit' } as MenuItemConstructorOptions]),
      ],
    },
    {
      label: t('Edit'),
      submenu: [
        // Undo/redo would steal Ctrl+Z / Ctrl+Y from the shell on Windows and Linux.
        ...(isMac ? [{ role: 'undo' }, { role: 'redo' }, sep] as MenuItemConstructorOptions[] : []),
        { role: 'cut', accelerator: isMac ? 'Cmd+X' : 'Ctrl+Shift+X' },
        role('copy', 'copy'),
        // Tezgah's own paste: files and images become paths Claude Code can attach.
        item(t('Paste'), 'paste'),
        role('selectAll', 'selectAll'),
        sep,
        item(t('Find…'), 'find'),
        item(t('Clear Terminal'), 'clear'),
      ],
    },
    {
      label: t('View'),
      submenu: [
        item(t('Go to Session…'), 'palette'),
        item(t('Changes'), 'changes'),
        item(t('Toggle Sidebar'), 'sidebar'),
        sep,
        item(t('Split Right'), 'split-row'),
        item(t('Split Down'), 'split-column'),
        item(t('Open Browser'), 'browser'),
        sep,
        item(t('Bigger'), 'font-up'),
        item(t('Smaller'), 'font-down'),
        item(t('Actual Size'), 'font-reset'),
        sep,
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools', accelerator: isMac ? 'Alt+Cmd+I' : 'F12' } as MenuItemConstructorOptions]),
      ],
    },
    {
      label: t('Session'),
      submenu: [
        item(t('Next Session'), 'next'),
        item(t('Previous Session'), 'prev'),
        item(t('Next Session That Needs You'), 'next-waiting'),
        item(t('Latest Unread Notification'), 'jump-unread'),
        item(t('Notifications'), 'inbox'),
        sep,
        item(t('Allow'), 'allow'),
        item(t('Deny'), 'deny'),
        ...(isMac ? [item(t('Interrupt'), 'interrupt')] : []),
        item(t('Restart Pane'), 'restart'),
        sep,
        ...Array.from({ length: 9 }, (_, i): MenuItemConstructorOptions => ({
          label: t('Session {n}', { n: i + 1 }),
          accelerator: gotoAccelerator(i + 1, isMac),
          click: send(`goto-${i}`),
        })),
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [{ label: t('Tezgah on GitHub'), click: () => shell.openExternal('https://github.com/itsyunusacar/tezgah') }],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// IPC

function registerIpc(): void {
  ipcMain.handle('load', () => ({
    workspace: readJson<Workspace>('workspace.json', { projects: [], sessions: [] }),
    settings: readJson<Settings>('settings.json', defaultSettings),
    version: app.getVersion(),
    home: os.homedir(),
  }))
  ipcMain.on('save-workspace', (_e, ws: Workspace) => writeJson('workspace.json', ws))
  ipcMain.on('save-settings', (_e, s: Settings) => {
    writeJson('settings.json', s)
    nativeTheme.themeSource = s.theme
    const lang = resolveLanguage(s.language, app.getLocale())
    const keys = JSON.stringify(s.shortcuts ?? {})
    if (lang !== language() || keys !== lastShortcuts) {
      setLanguage(lang)
      setOverrides(s.shortcuts as never)
      lastShortcuts = keys
      buildMenu()
      refreshTray(() => win)
    }
  })

  const scrollbackFile = (id: string) => (/^[\w-]{8,64}$/.test(id) ? path.join(dataDir(), 'scrollback', `${id}.txt`) : undefined)
  ipcMain.on('save-scrollback', (e, id: string, data: string) => {
    const f = scrollbackFile(id)
    try {
      if (f) {
        fs.mkdirSync(path.dirname(f), { recursive: true })
        fs.writeFileSync(f, data.slice(-(2 << 20)))
      }
    } catch {
      // Best effort.
    }
    e.returnValue = true
  })
  ipcMain.handle('load-scrollback', (_e, id: string) => {
    const f = scrollbackFile(id)
    try {
      return f ? fs.readFileSync(f, 'utf8') : null
    } catch {
      return null
    }
  })
  // A closed pane leaves nothing behind: its saved screen and its MCP config.
  ipcMain.on('drop-scrollback', (_e, id: string) => {
    const f = scrollbackFile(id)
    if (!f) return
    fs.rmSync(f, { force: true })
    fs.rmSync(path.join(dataDir(), 'mcp', `${id}.json`), { force: true })
  })
  ipcMain.handle('pty-start', (e, opts) => pty.start(e.sender, opts))
  ipcMain.on('pty-write', (_e, id: string, data: string) => pty.write(id, data))
  ipcMain.on('pty-resize', (_e, id: string, cols: number, rows: number) => pty.resize(id, cols, rows))
  ipcMain.on('pty-kill', (_e, id: string) => pty.kill(id))

  ipcMain.handle('pick-folder', async () => {
    const res = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })
    return res.canceled ? undefined : res.filePaths[0]
  })
  ipcMain.handle('claude-has', (_e, id: string) => Boolean(claude.conversationFile(id)))
  ipcMain.handle('subagents', (_e, id: string) => claude.subagents(id))
  ipcMain.handle('conversation-stats', (_e, claudeId: string) => claude.conversationStats(claudeId))
  ipcMain.handle('agent-transcript', (_e, claudeId: string, agentId: string) => claude.agentTranscript(claudeId, agentId))
  ipcMain.handle('recent', () => claude.recentConversations())
  ipcMain.handle('usage', () => allUsage())
  ipcMain.handle('check-update', () => updates.check())
  ipcMain.handle('tools', () => meta.tools())
  ipcMain.handle('default-terminal', () => defaultTerminal.status())
  ipcMain.handle('make-default-terminal', () => defaultTerminal.makeDefault())
  ipcMain.handle('mcp-config', (_e, paneId: string) => mcpConfigFile(paneId))
  ipcMain.handle('ghostty-look', () => ghosttyLook())
  ipcMain.handle('browser-act', (_e, id: number, action: string, args: browser.BrowserArgs) => browser.act(id, action, args))

  ipcMain.handle('session-meta', (_e, cwd: string, paneIds: string[]) =>
    meta.sessionMeta(cwd, paneIds.map(pty.pid).filter((p): p is number => !!p)))
  ipcMain.handle('diff', (_e, cwd: string, base?: string) => git.diff(cwd, base))
  ipcMain.handle('git-status', (_e, cwd: string) => git.status(cwd))
  ipcMain.handle('git-commit', (_e, cwd: string, message: string) => git.commit(cwd, message))
  ipcMain.handle('git-push', (_e, cwd: string) => git.push(cwd))
  ipcMain.handle('git-pr', (_e, cwd: string) => git.createPr(cwd))
  ipcMain.handle('is-repo', (_e, cwd: string) => git.isRepo(cwd))
  ipcMain.handle('wt-add', (_e, repo: string, branch: string) => git.worktreeAdd(repo, branch))
  ipcMain.handle('wt-remove', (_e, repo, wt, del) => git.worktreeRemove(repo, wt, del))
  ipcMain.handle('wt-merge', (_e, repo, wt) => git.worktreeMerge(repo, wt))

  ipcMain.on('tray', (_e, state) => updateTray(state, () => win))
  ipcMain.on('menu-suspend', (_e, on: boolean) => (on ? Menu.setApplicationMenu(null) : buildMenu()))
  ipcMain.on('badge', (_e, count: number) => {
    app.setBadgeCount(count)
    if (isMac) app.dock?.setBadge(count ? String(count) : '')
  })
  ipcMain.on('notify', (_e, title: string, body: string, sessionId: string) => {
    if (!Notification.isSupported()) return
    const n = new Notification({ title, body, silent: false })
    n.on('click', () => {
      win?.show()
      win?.focus()
      win?.webContents.send('notification-click', sessionId)
    })
    n.show()
  })
  ipcMain.on('open-external', (_e, url: string) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
  })
  ipcMain.on('reveal', (_e, p: string) => shell.showItemInFolder(p))
  ipcMain.handle('clipboard-paste', () => clipboardPaste())
  ipcMain.handle('scp-upload', (_e, target: string, files: string[]) => scpUpload(target, files))
  ipcMain.on('native-paste', (e) => e.sender.paste())
}

// Clipboard: files copied in the file manager, or an image, paste as paths.
// Electron's clipboard is asynchronous and typed by MIME, like the web's: files come as text/uri-list,
// images as image/png, and other system formats under `electron application/osclipboard`.

const systemFormat = (f: string) => `electron application/osclipboard;format="${f}"`

/** The clipboard's data of one type, if any entry carries it. */
async function clipboardData(items: Electron.ClipboardItem[], type: string): Promise<Blob | undefined> {
  const item = items.find((i) => i.types.includes(type))
  return item ? ((await item.getType(type)) as Blob) : undefined
}

async function copiedFiles(items: Electron.ClipboardItem[]): Promise<string[]> {
  try {
    const uris = await clipboardData(items, 'text/uri-list')
    const fromUris = (await uris?.text() ?? '').split(/\r?\n/).filter((l) => l.startsWith('file://')).map((u) => fileURLToPath(u))
    if (fromUris.length) return fromUris
    // Explorer's copied files, should they not show up as a URI list.
    const names = process.platform === 'win32' && (await clipboardData(items, systemFormat('FileNameW')))
    if (names) return Buffer.from(await names.arrayBuffer()).toString('utf16le').split('\0').filter(Boolean)
  } catch {
    // Unreadable data is no files.
  }
  return []
}

async function clipboardPaste(): Promise<{ paths: string[]; text: string }> {
  const items = await clipboard.read().catch(() => [])
  const files = (await copiedFiles(items)).filter((p) => fs.existsSync(p))
  if (files.length) return { paths: files, text: '' }
  const text = await clipboard.readText().catch(() => '')
  const image = !text && (await clipboardData(items, 'image/png').catch(() => undefined))
  if (image) {
    // A screenshot or copied image: save it so the agent can read it by path.
    const dir = path.join(os.tmpdir(), 'tezgah-images')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `image-${new Date().toISOString().replace(/[:.]/g, '-')}.png`)
    fs.writeFileSync(file, Buffer.from(await image.arrayBuffer()))
    return { paths: [file], text: '' }
  }
  return { paths: [], text }
}

// Browser panes: plain web pages, without Node or Tezgah's API, opening new windows in place.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (e, prefs, params) => {
    delete prefs.preload
    prefs.nodeIntegration = false
    prefs.contextIsolation = true
    prefs.sandbox = true
    if (!/^(https?:|file:|about:blank)/.test(params.src)) e.preventDefault()
  })
  if (contents.getType() === 'webview') {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) contents.loadURL(url)
      return { action: 'deny' }
    })
  }
})

/** Uploads files to an SSH host with the user's own ssh setup (keys, agent, config); never prompts. */
function scpUpload(target: string, files: string[]): Promise<string[]> {
  if (!/^[\w.@:-]+$/.test(target) || target.startsWith('-')) return Promise.reject(new Error('Bad SSH target'))
  const remote = files.map((f) => `/tmp/tezgah-${Date.now().toString(36)}-${path.basename(f).replace(/[^\w.-]/g, '_')}`)
  const copies = files.map((f, i) =>
    new Promise<void>((resolve, reject) =>
      execFile('scp', ['-q', '-o', 'BatchMode=yes', '--', f, `${target}:${remote[i]}`], { timeout: 120_000 }, (err, _o, stderr) =>
        err ? reject(new Error(stderr.trim() || err.message)) : resolve(),
      ),
    ),
  )
  return Promise.all(copies).then(() => remote)
}

// App lifecycle

// Started from the Dock or Finder, the app gets a bare PATH; add the usual places for git, gh and claude.
if (process.platform !== 'win32') {
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.local/bin'), path.join(os.homedir(), 'bin')]
  const parts = (process.env.PATH ?? '/usr/bin:/bin').split(':')
  process.env.PATH = [...parts, ...extra.filter((d) => !parts.includes(d))].join(':')
}

// Where Tezgah keeps its projects, sessions and settings (set before the single-instance lock, which is
// per folder). Tests and screenshots pass a throwaway one; a development build (npm run dev) keeps its
// own, "Tezgah Dev", so it runs beside the installed app without touching your everyday workspace.
if (process.env.TEZGAH_USER_DATA) app.setPath('userData', process.env.TEZGAH_USER_DATA)
else if (!app.isPackaged) app.setPath('userData', path.join(app.getPath('appData'), 'Tezgah Dev'))

// A second launch hands its own arguments over as data: the argv Electron gives the first instance
// has Chromium's switches mixed in, which would end up inside a `-e command`.
if (!app.requestSingleInstanceLock({ argv: process.argv, cwd: process.cwd() })) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv, cwd, data) => {
    if (!win) createWindow()
    const sent = data as { argv?: string[]; cwd?: string } | undefined
    requestsIn(Array.isArray(sent?.argv) ? sent.argv : argv, sent?.cwd ?? cwd).forEach(deliver)
    win?.show()
    win?.focus()
  })
  app.on('open-file', (e, p) => {
    e.preventDefault()
    openPath(p)
  })
  app.on('open-url', (e, url) => {
    e.preventDefault()
    openUrl(url)
  })
  app.whenReady().then(() => {
    app.setName('Tezgah')
    const saved = readJson<Settings>('settings.json', defaultSettings)
    nativeTheme.themeSource = saved.theme
    setLanguage(resolveLanguage(saved.language, app.getLocale()))
    setOverrides(saved.shortcuts as never)
    lastShortcuts = JSON.stringify(saved.shortcuts ?? {})
    registerIpc()
    browser.watchNetwork()
    startControl(() => win?.webContents)
    buildMenu()
    pending.push(...requestsIn(process.argv))
    createWindow()
    createTray(() => win)
    app.on('activate', () => {
      if (!win) createWindow()
    })
  })
  app.on('window-all-closed', () => {
    pty.killAll()
    if (!isMac) app.quit()
  })
  app.on('before-quit', () => pty.killAll())
}
