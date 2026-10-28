import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, Notification, shell } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import * as pty from './pty'
import * as claude from './claude'
import * as git from './git'
import { defaultSettings, type Settings, type Workspace } from '../shared/types'
import { accelerator, gotoAccelerator, type Command } from '../shared/shortcuts'

const isMac = process.platform === 'darwin'
let win: BrowserWindow | null = null
/** Folders asked to open before the window was ready. */
const pendingFolders: string[] = []

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
    for (const folder of pendingFolders.splice(0)) win?.webContents.send('open-folder', folder)
  })
}

function openFolder(folder: string): void {
  try {
    if (!fs.statSync(folder).isDirectory()) return
  } catch {
    return
  }
  if (win && !win.webContents.isLoading()) win.webContents.send('open-folder', folder)
  else pendingFolders.push(folder)
  win?.show()
  win?.focus()
}

/** Folders passed on the command line: `tezgah ~/code/app`. */
function foldersIn(argv: string[]): string[] {
  return argv.slice(app.isPackaged ? 1 : 2).filter((a) => !a.startsWith('-') && fs.existsSync(a)).map((a) => path.resolve(a))
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
            { role: 'about' }, sep, item('Settings…', 'settings'), sep,
            { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, sep, { role: 'quit' },
          ],
        } as MenuItemConstructorOptions]
      : []),
    {
      label: 'File',
      submenu: [
        item('New Claude Session', 'new-claude'),
        item('New Shell Session', 'new-shell'),
        item('New Session in a Worktree…', 'new-worktree'),
        sep,
        item('Open Folder…', 'open-folder'),
        item('Recent Conversations…', 'recent'),
        sep,
        item('Close Pane', 'close-pane'),
        item('Close Session', 'close-session'),
        ...(isMac ? [] : [sep, item('Settings…', 'settings'), sep, { role: 'quit' } as MenuItemConstructorOptions]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        // Undo/redo would steal Ctrl+Z / Ctrl+Y from the shell on Windows and Linux.
        ...(isMac ? [{ role: 'undo' }, { role: 'redo' }, sep] as MenuItemConstructorOptions[] : []),
        { role: 'cut', accelerator: isMac ? 'Cmd+X' : 'Ctrl+Shift+X' },
        role('copy', 'copy'),
        role('paste', 'paste'),
        role('selectAll', 'selectAll'),
        sep,
        item('Clear Terminal', 'clear'),
      ],
    },
    {
      label: 'View',
      submenu: [
        item('Go to Session…', 'palette'),
        item('Changes', 'changes'),
        item('Toggle Sidebar', 'sidebar'),
        sep,
        item('Split Right', 'split-row'),
        item('Split Down', 'split-column'),
        sep,
        item('Bigger', 'font-up'),
        item('Smaller', 'font-down'),
        item('Actual Size', 'font-reset'),
        sep,
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' } as MenuItemConstructorOptions]),
      ],
    },
    {
      label: 'Session',
      submenu: [
        item('Next Session', 'next'),
        item('Previous Session', 'prev'),
        item('Next Session That Needs You', 'next-waiting'),
        sep,
        item('Allow', 'allow'),
        item('Deny', 'deny'),
        ...(isMac ? [item('Interrupt', 'interrupt')] : []),
        item('Restart Pane', 'restart'),
        sep,
        ...Array.from({ length: 9 }, (_, i): MenuItemConstructorOptions => ({
          label: `Session ${i + 1}`,
          accelerator: gotoAccelerator(i + 1, isMac),
          click: send(`goto-${i}`),
        })),
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [{ label: 'Tezgah on GitHub', click: () => shell.openExternal('https://github.com/itsyunusacar/tezgah') }],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// IPC

function registerIpc(): void {
  ipcMain.handle('load', () => ({
    workspace: readJson<Workspace>('workspace.json', { projects: [], sessions: [] }),
    settings: readJson<Settings>('settings.json', defaultSettings),
  }))
  ipcMain.on('save-workspace', (_e, ws: Workspace) => writeJson('workspace.json', ws))
  ipcMain.on('save-settings', (_e, s: Settings) => {
    writeJson('settings.json', s)
    nativeTheme.themeSource = s.theme
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
  ipcMain.handle('recent', () => claude.recentConversations())
  ipcMain.handle('usage', () => claude.usage())

  ipcMain.handle('diff', (_e, cwd: string, base?: string) => git.diff(cwd, base))
  ipcMain.handle('is-repo', (_e, cwd: string) => git.isRepo(cwd))
  ipcMain.handle('wt-add', (_e, repo: string, branch: string) => git.worktreeAdd(repo, branch))
  ipcMain.handle('wt-remove', (_e, repo, wt, del) => git.worktreeRemove(repo, wt, del))
  ipcMain.handle('wt-merge', (_e, repo, wt) => git.worktreeMerge(repo, wt))

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
}

// App lifecycle

// Lets tests and screenshots run against a throwaway profile (set before the single-instance lock).
if (process.env.TEZGAH_USER_DATA) app.setPath('userData', process.env.TEZGAH_USER_DATA)

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    foldersIn(argv).forEach(openFolder)
    win?.show()
    win?.focus()
  })
  app.on('open-file', (e, p) => {
    e.preventDefault()
    openFolder(p)
  })
  app.whenReady().then(() => {
    app.setName('Tezgah')
    nativeTheme.themeSource = readJson<Settings>('settings.json', defaultSettings).theme
    registerIpc()
    buildMenu()
    pendingFolders.push(...foldersIn(process.argv))
    createWindow()
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
