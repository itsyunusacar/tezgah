// Keyboard shortcuts, per platform. On macOS they use ⌘, which terminals never see.
// On Windows and Linux plain Ctrl+<letter> belongs to the shell (Ctrl+C, Ctrl+W, Ctrl+K…),
// so app commands use Ctrl+Shift, like other terminals there.

export const shortcuts = {
  'new-claude': ['Cmd+T', 'Ctrl+Shift+T'],
  'new-shell': ['Cmd+Shift+T', 'Ctrl+Shift+N'],
  'new-worktree': ['Cmd+Alt+T', 'Ctrl+Alt+Shift+T'],
  'open-folder': ['Cmd+O', 'Ctrl+Shift+O'],
  recent: ['Cmd+Shift+O', 'Ctrl+Shift+H'],
  'close-pane': ['Cmd+W', 'Ctrl+Shift+W'],
  'close-session': ['Cmd+Shift+W', 'Ctrl+Alt+Shift+W'],
  clear: ['Cmd+K', 'Ctrl+Shift+K'],
  palette: ['Cmd+P', 'Ctrl+Shift+P'],
  changes: ['Cmd+Shift+D', 'Ctrl+Shift+G'],
  sidebar: ['Cmd+B', 'Ctrl+Shift+B'],
  browser: ['Cmd+Shift+L', 'Ctrl+Shift+Y'],
  'split-row': ['Cmd+D', 'Alt+Shift+='],
  'split-column': ['Cmd+Alt+D', 'Alt+Shift+-'],
  next: ['Cmd+Shift+]', 'Ctrl+Tab'],
  prev: ['Cmd+Shift+[', 'Ctrl+Shift+Tab'],
  'next-waiting': ['Cmd+J', 'Ctrl+Shift+J'],
  'jump-unread': ['Cmd+Shift+U', 'Ctrl+Shift+L'],
  inbox: ['Cmd+I', 'Ctrl+Shift+I'],
  find: ['Cmd+F', 'Ctrl+Shift+F'],
  allow: ['Cmd+Shift+Enter', 'Ctrl+Shift+Enter'],
  deny: ['Cmd+Shift+Backspace', 'Ctrl+Shift+Backspace'],
  interrupt: ['Cmd+.', ''],
  restart: ['Cmd+Shift+R', 'Ctrl+Shift+R'],
  settings: ['Cmd+,', 'Ctrl+,'],
  'font-up': ['Cmd+=', 'Ctrl+='],
  'font-down': ['Cmd+-', 'Ctrl+-'],
  'font-reset': ['Cmd+0', 'Ctrl+0'],
  copy: ['Cmd+C', 'Ctrl+Shift+C'],
  paste: ['Cmd+V', 'Ctrl+Shift+V'],
  selectAll: ['Cmd+A', 'Ctrl+Shift+A'],
} as const

export type Command = keyof typeof shortcuts

export function accelerator(cmd: Command, mac: boolean): string | undefined {
  return shortcuts[cmd][mac ? 0 : 1] || undefined
}

/** "⌘T" on macOS, "Ctrl+Shift+T" elsewhere. */
export function label(cmd: Command, mac: boolean): string {
  const acc = accelerator(cmd, mac)
  if (!acc) return ''
  if (!mac) return acc
  const symbols: Record<string, string> = { Cmd: '⌘', Shift: '⇧', Alt: '⌥', Ctrl: '⌃', Enter: '↩', Backspace: '⌫' }
  const parts = acc.split('+').map((p) => symbols[p] ?? p)
  const key = parts.pop()!
  const order = ['⌃', '⌥', '⇧', '⌘']
  return parts.sort((a, b) => order.indexOf(a) - order.indexOf(b)).join('') + key
}

/** Session N: ⌘1…⌘9 on macOS, Alt+1…9 elsewhere. */
export const gotoAccelerator = (n: number, mac: boolean) => (mac ? `Cmd+${n}` : `Alt+${n}`)
