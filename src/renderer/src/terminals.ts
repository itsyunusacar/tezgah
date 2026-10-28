import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { applyReport, parseOsc7501 } from './osc'
import { store } from './store'

// Every pane's terminal lives here for the whole app session, so switching sessions
// never restarts a program or loses scrollback. Its element moves between the pane
// that shows it and an off-screen parking spot.

interface Entry {
  term: Terminal
  fit: FitAddon
  el: HTMLDivElement
  started: boolean
  visible: boolean
}

const entries = new Map<string, Entry>()
let parking: HTMLDivElement | undefined

export const isMac = window.tz.platform === 'darwin'

const light: ITheme = {
  background: '#FDFCFC', foreground: '#1A1918', cursor: '#0C0B0A', cursorAccent: '#FDFCFC',
  selectionBackground: '#DCE6FB',
  // "White" is meant for dark backgrounds; on paper it becomes a readable gray.
  black: '#1A1918', red: '#C4352B', green: '#2E7D46', yellow: '#946200', blue: '#2F5FD0', magenta: '#8E44AD', cyan: '#1F7A8C', white: '#8F8981',
  brightBlack: '#5C5751', brightRed: '#E5484D', brightGreen: '#3A9A5B', brightYellow: '#B58400', brightBlue: '#4B7BEC', brightMagenta: '#A35BC2', brightCyan: '#2C96A8', brightWhite: '#6B665F',
}
const dark: ITheme = {
  background: '#0E0D0C', foreground: '#EDEAE6', cursor: '#F5F3F1', cursorAccent: '#0E0D0C',
  selectionBackground: '#2A3550',
  black: '#1A1918', red: '#E5484D', green: '#46A758', yellow: '#E2B93B', blue: '#5B8DEF', magenta: '#B57EDC', cyan: '#4CC3D9', white: '#C9C3BB',
  brightBlack: '#5C5751', brightRed: '#FF6369', brightGreen: '#63C174', brightYellow: '#F1CB5B', brightBlue: '#7FA6F5', brightMagenta: '#CB9EEA', brightCyan: '#74D4E6', brightWhite: '#FFFFFF',
}

export const isDark = () => document.documentElement.dataset.theme === 'dark'

/** Programs often assume a dark background and print white or pale text. On the light theme,
 *  xterm darkens any color (16, 256 or true color) that would fall below this contrast. */
const contrast = () => (isDark() ? 1 : 4.5)

function parkingSpot(): HTMLDivElement {
  if (!parking) {
    parking = document.createElement('div')
    parking.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:500px;overflow:hidden;visibility:hidden'
    document.body.appendChild(parking)
  }
  return parking
}

function create(paneId: string): Entry {
  const term = new Terminal({
    fontFamily: '"Geist Mono", ui-monospace, Menlo, Consolas, monospace',
    fontSize: store().settings.fontSize,
    lineHeight: 1.2,
    cursorBlink: true,
    cursorStyle: 'bar',
    scrollback: 10_000,
    allowProposedApi: true,
    macOptionIsMeta: false,
    theme: isDark() ? dark : light,
    minimumContrastRatio: contrast(),
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.loadAddon(new Unicode11Addon())
  term.unicode.activeVersion = '11'
  term.loadAddon(new WebLinksAddon((e, url) => {
    if (isMac ? e.metaKey : e.ctrlKey) window.tz.openExternal(url)
  }))

  const el = document.createElement('div')
  el.className = 'term-host'
  parkingSpot().appendChild(el)
  term.open(el)
  try {
    term.loadAddon(new WebglAddon())
  } catch {
    // No WebGL (some Linux VMs): the DOM renderer still works.
  }

  // Claude Code's live status. Answer the probe so it starts reporting.
  term.parser.registerOscHandler(7501, (data) => {
    if (data === '?') {
      window.tz.ptyWrite(paneId, '\x1b]7501;?\x07')
      return true
    }
    const report = parseOsc7501(data)
    if (report) store().setPane(paneId, (p) => ({ records: applyReport(p.records, report) }))
    return true
  })
  term.onTitleChange((title) => store().setPane(paneId, { title }))
  term.onData((data) => window.tz.ptyWrite(paneId, data))
  term.onResize(({ cols, rows }) => window.tz.ptyResize(paneId, cols, rows))

  // On Windows and Linux, Ctrl+C copies when there is a selection; otherwise it's SIGINT.
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true
    if (!isMac && e.ctrlKey && !e.shiftKey && e.key === 'c' && term.hasSelection()) {
      navigator.clipboard.writeText(term.getSelection())
      term.clearSelection()
      return false
    }
    // Shift+Enter: a newline in Claude Code's prompt instead of sending it.
    if (e.key === 'Enter' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      window.tz.ptyWrite(paneId, '\x1b\r')
      return false
    }
    return true
  })

  const entry: Entry = { term, fit, el, started: false, visible: false }
  entries.set(paneId, entry)
  return entry
}

/** Starts the pane's process the first time it is shown. */
export function attach(paneId: string, container: HTMLElement, start: () => { cwd: string; command?: string }): void {
  const entry = entries.get(paneId) ?? create(paneId)
  container.appendChild(entry.el)
  entry.visible = true
  store().setPane(paneId, { activity: false })
  requestAnimationFrame(() => {
    fit(paneId)
    if (!entry.started) {
      entry.started = true
      const { cwd, command } = start()
      window.tz.ptyStart({ paneId, cwd, command, cols: entry.term.cols, rows: entry.term.rows, light: !isDark() })
    }
  })
}

export function detach(paneId: string): void {
  const entry = entries.get(paneId)
  if (!entry) return
  entry.visible = false
  parkingSpot().appendChild(entry.el)
}

export function fit(paneId: string): void {
  const entry = entries.get(paneId)
  if (!entry || !entry.visible || !entry.el.isConnected) return
  try {
    entry.fit.fit()
    // Moving the element between containers can leave the canvas blank until the next write.
    entry.term.refresh(0, entry.term.rows - 1)
  } catch {
    // Zero-sized while a layout settles.
  }
}

export function focus(paneId: string): void {
  entries.get(paneId)?.term.focus()
}

export function restart(paneId: string, start: () => { cwd: string; command?: string }): void {
  const entry = entries.get(paneId)
  if (!entry) return
  entry.term.reset()
  store().setPane(paneId, { records: [], exited: false, title: '' })
  const { cwd, command } = start()
  window.tz.ptyStart({ paneId, cwd, command, cols: entry.term.cols, rows: entry.term.rows, light: !isDark() })
}

export function dispose(paneId: string): void {
  const entry = entries.get(paneId)
  window.tz.ptyKill(paneId)
  if (!entry) return
  entry.term.dispose()
  entry.el.remove()
  entries.delete(paneId)
}

export function send(paneId: string, data: string): void {
  window.tz.ptyWrite(paneId, data)
}

/** Pastes text into a pane as if typed (bracketed paste when the program asked for it), then optionally submits. */
export function paste(paneId: string, text: string, submit: boolean): void {
  const entry = entries.get(paneId)
  if (!entry) return
  entry.term.paste(text)
  if (submit) setTimeout(() => window.tz.ptyWrite(paneId, '\r'), 150)
}

export function clear(paneId: string): void {
  entries.get(paneId)?.term.clear()
}

export function applyTheme(): void {
  for (const { term } of entries.values()) {
    term.options.theme = isDark() ? dark : light
    term.options.minimumContrastRatio = contrast()
  }
}

export function applyFontSize(size: number): void {
  for (const [id, { term }] of entries) {
    term.options.fontSize = size
    fit(id)
  }
}

// Output from every pane arrives here.
window.tz.onPtyData((paneId, data) => {
  const entry = entries.get(paneId)
  if (!entry) return
  entry.term.write(data)
  if (!entry.visible && !store().panes[paneId]?.activity) store().setPane(paneId, { activity: true })
})
window.tz.onPtyExit((paneId) => {
  store().setPane(paneId, (p) => ({
    exited: true,
    // A finished program can't still be working or waiting.
    records: p.records.filter((r) => r.state !== 'working' && r.state !== 'blocked'),
  }))
})
