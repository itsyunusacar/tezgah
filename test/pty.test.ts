import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {}, ipcMain: {} }))
vi.mock('node-pty', () => ({}))
const { inherited, programName } = await import('../src/main/pty')

describe('inherited', () => {
  it("drops another terminal's identity and keeps the rest", () => {
    const env = inherited({
      PATH: '/usr/bin', HOME: '/Users/me', LANG: 'tr_TR.UTF-8', SSH_AUTH_SOCK: '/tmp/agent', TERMINFO_DIRS: '/x',
      TMUX: '/tmp/tmux-501/default,1,0', TMUX_PANE: '%1', TERM_PROGRAM: 'iTerm.app', TERM_PROGRAM_VERSION: '3.5',
      LC_TERMINAL: 'iTerm2', LC_TERMINAL_VERSION: '3.5', ITERM_SESSION_ID: 'w0t0p0', KITTY_WINDOW_ID: '1',
      WT_SESSION: 'abc', WT_PROFILE_ID: '{x}', VSCODE_INJECTION: '1', VSCODE_GIT_IPC_HANDLE: '/tmp/s', GHOSTTY_RESOURCES_DIR: '/g',
      CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--inspect', UNSET: undefined,
    })
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/Users/me', LANG: 'tr_TR.UTF-8', SSH_AUTH_SOCK: '/tmp/agent', TERMINFO_DIRS: '/x' })
  })
})

describe('programName', () => {
  it('names a program however the system spells it', () => {
    expect(['-zsh', '/bin/bash', 'pwsh.exe', 'PowerShell.EXE', 'top'].map(programName)).toEqual(['zsh', 'bash', 'pwsh', 'powershell', 'top'])
  })
})
