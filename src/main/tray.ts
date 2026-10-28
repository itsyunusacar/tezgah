import { app, Menu, nativeImage, Tray, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import path from 'node:path'
import type { TrayState } from '../shared/types'

// Tezgah in the menu bar (the system tray on Windows and Linux): how many agents are working or
// waiting on you, and a way to jump to them without finding the window.

let tray: Tray | null = null
let state: TrayState = { sessions: [] }

function icon() {
  const dir = path.join(__dirname, '../../resources')
  if (process.platform === 'darwin') {
    // A template image: macOS tints it to match the menu bar.
    const img = nativeImage.createFromPath(path.join(dir, 'trayTemplate.png'))
    img.setTemplateImage(true)
    return img
  }
  return nativeImage.createFromPath(path.join(dir, 'icon.png')).resize({ width: 16, height: 16 })
}

const MARK: Record<string, string> = { blocked: '●', working: '◌', done: '✓', error: '!', idle: '·' }

function build(win: () => BrowserWindow | null): void {
  if (!tray) return
  const show = (then?: (w: BrowserWindow) => void) => {
    const w = win()
    if (!w) return
    w.show()
    w.focus()
    then?.(w)
  }
  const send = (action: string) => show((w) => w.webContents.send('menu', action))
  const pick = (id: string) => show((w) => w.webContents.send('notification-click', id))

  const waiting = state.sessions.filter((s) => s.status === 'blocked')
  const working = state.sessions.filter((s) => s.status === 'working')
  const done = state.sessions.filter((s) => s.status === 'done' && s.unseen)
  const summary = [
    waiting.length ? `${waiting.length} need${waiting.length === 1 ? 's' : ''} you` : '',
    working.length ? `${working.length} working` : '',
    done.length ? `${done.length} done` : '',
  ].filter(Boolean).join(' · ') || 'Nothing running'

  const row = (s: TrayState['sessions'][number]): MenuItemConstructorOptions => ({
    label: `${MARK[s.status ?? 'idle'] ?? '·'}  ${s.title}${s.project ? `  —  ${s.project}` : ''}`,
    sublabel: s.line || undefined,
    click: () => pick(s.id),
  })
  const listed = [...waiting, ...done, ...working]
  const rest = state.sessions.filter((s) => !listed.includes(s)).slice(0, 8)

  const template: MenuItemConstructorOptions[] = [
    { label: summary, enabled: false },
    { type: 'separator' },
    ...listed.map(row),
    ...(listed.length && rest.length ? [{ type: 'separator' } as MenuItemConstructorOptions] : []),
    ...(rest.length ? [{ label: 'Sessions', enabled: false } as MenuItemConstructorOptions, ...rest.map(row)] : []),
    ...(state.sessions.length ? [{ type: 'separator' } as MenuItemConstructorOptions] : []),
    { label: 'Next Session That Needs You', enabled: waiting.length + done.length > 0, click: () => send('next-waiting') },
    { label: 'New Claude Session', click: () => send('new-claude') },
    { label: 'Notifications', click: () => send('inbox') },
    { type: 'separator' },
    { label: 'Show Tezgah', click: () => show() },
    { label: 'Quit Tezgah', role: 'quit' },
  ]
  tray.setContextMenu(Menu.buildFromTemplate(template))
  tray.setToolTip(`Tezgah — ${summary}`)
  // The count of sessions waiting on you, next to the icon (macOS shows text in the menu bar).
  if (process.platform === 'darwin') tray.setTitle(waiting.length ? String(waiting.length) : '', { fontType: 'monospacedDigit' })
}

export function createTray(win: () => BrowserWindow | null): void {
  if (tray) return
  tray = new Tray(icon())
  build(win)
  app.on('before-quit', () => {
    tray?.destroy()
    tray = null
  })
}

export function updateTray(next: TrayState, win: () => BrowserWindow | null): void {
  state = next
  build(win)
}
