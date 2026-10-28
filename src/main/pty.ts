import * as pty from 'node-pty'
import os from 'node:os'
import fs from 'node:fs'
import type { WebContents } from 'electron'

interface Running {
  proc: pty.IPty
  /** Typed into the shell once it has printed its first prompt. */
  pending?: string
}

const running = new Map<string, Running>()

/** The user's shell, started as an interactive login shell so PATH matches their normal terminal. */
function shell(): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    const pwsh = ['pwsh.exe', 'powershell.exe'].find((p) =>
      (process.env.PATH ?? '').split(';').some((dir) => fs.existsSync(`${dir}\\${p}`)),
    )
    return { file: pwsh ?? process.env.COMSPEC ?? 'cmd.exe', args: pwsh ? ['-NoLogo'] : [] }
  }
  const file = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  return { file, args: ['-l'] }
}

/** The parent's environment, minus markers that would confuse programs started here
 *  (Tezgah itself may have been launched from inside a Claude Code session). */
function environment(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue
    if (k.startsWith('CLAUDE_CODE_') || k === 'CLAUDECODE' || k.startsWith('ELECTRON_') || k === 'NODE_OPTIONS') continue
    env[k] = v
  }
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.TERM_PROGRAM = 'Tezgah'
  if (!env.LANG && process.platform !== 'win32') env.LANG = 'en_US.UTF-8'
  return env
}

export function start(
  web: WebContents,
  opts: { paneId: string; cwd: string; command?: string; cols: number; rows: number },
): void {
  kill(opts.paneId)
  const cwd = fs.existsSync(opts.cwd) ? opts.cwd : os.homedir()
  const { file, args } = shell()
  const proc = pty.spawn(file, args, {
    name: 'xterm-256color',
    cols: Math.max(2, opts.cols),
    rows: Math.max(2, opts.rows),
    cwd,
    env: environment(),
  })
  const entry: Running = { proc, pending: opts.command }
  running.set(opts.paneId, entry)

  let timer: NodeJS.Timeout | undefined
  proc.onData((data) => {
    if (web.isDestroyed()) return
    web.send('pty:data', opts.paneId, data)
    // Send the startup command once the shell has gone quiet after its first output (its prompt).
    if (entry.pending) {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (!entry.pending) return
        proc.write(entry.pending + (process.platform === 'win32' ? '\r' : '\n'))
        entry.pending = undefined
      }, 120)
    }
  })
  proc.onExit(({ exitCode }) => {
    if (running.get(opts.paneId)?.proc === proc) running.delete(opts.paneId)
    if (!web.isDestroyed()) web.send('pty:exit', opts.paneId, exitCode)
  })
}

export function write(paneId: string, data: string): void {
  running.get(paneId)?.proc.write(data)
}

export function resize(paneId: string, cols: number, rows: number): void {
  try {
    running.get(paneId)?.proc.resize(Math.max(2, cols), Math.max(2, rows))
  } catch {
    // The process may have exited between the layout change and the resize.
  }
}

export function kill(paneId: string): void {
  const entry = running.get(paneId)
  if (!entry) return
  running.delete(paneId)
  try {
    entry.proc.kill()
  } catch {
    // Already gone.
  }
}

export function killAll(): void {
  for (const id of [...running.keys()]) kill(id)
}
