import * as pty from 'node-pty'
import os from 'node:os'
import fs from 'node:fs'
import { execFile } from 'node:child_process'
import type { WebContents } from 'electron'
import path from 'node:path'
import { binDir, cliEnv } from './control'
import * as agents from './agents'

interface Running {
  proc: pty.IPty
  web: WebContents
  /** The agent last seen in its foreground. */
  agent?: string
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
function environment(paneId: string, light: boolean): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue
    if (k.startsWith('CLAUDE_CODE_') || k === 'CLAUDECODE' || k.startsWith('ELECTRON_') || k === 'NODE_OPTIONS') continue
    env[k] = v
  }
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.TERM_PROGRAM = 'Tezgah'
  // foreground;background in ANSI color numbers: lets vim, less and others pick readable colors.
  env.COLORFGBG = light ? '0;15' : '15;0'
  if (!env.LANG && process.platform !== 'win32') env.LANG = 'en_US.UTF-8'
  // The `tezgah` command, for scripts and agents running here.
  Object.assign(env, cliEnv(paneId))
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
  env[pathKey] = [binDir(), env[pathKey]].filter(Boolean).join(path.delimiter)
  return env
}

export function start(
  web: WebContents,
  opts: { paneId: string; cwd: string; command?: string; cols: number; rows: number; light?: boolean },
): void {
  kill(opts.paneId)
  const cwd = fs.existsSync(opts.cwd) ? opts.cwd : os.homedir()
  const { file, args } = shell()
  const proc = pty.spawn(file, args, {
    name: 'xterm-256color',
    cols: Math.max(2, opts.cols),
    rows: Math.max(2, opts.rows),
    cwd,
    env: environment(opts.paneId, opts.light ?? false),
  })
  const entry: Running = { proc, web, pending: opts.command }
  watchAgents()
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

// Agents in the foreground of each terminal, for the renderer's activity-based status.
let watching: NodeJS.Timeout | undefined
function watchAgents(): void {
  if (watching || process.platform === 'win32') return
  watching = setInterval(async () => {
    if (!running.size) return
    const byTty = await agents.scan()
    for (const [paneId, entry] of running) {
      const tty = (entry.proc as unknown as { ptsName?: string }).ptsName
      const agent = tty ? byTty.get(agents.ttyName(tty)) : undefined
      if (agent === entry.agent) continue
      entry.agent = agent
      if (!entry.web.isDestroyed()) entry.web.send('pty:agent', paneId, agent ?? null)
    }
  }, 2000)
}

export function pid(paneId: string): number | undefined {
  return running.get(paneId)?.proc.pid
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
  // On Windows, node-pty's kill() can block the main process (ConPTY), freezing the whole app;
  // end the shell and everything it started with taskkill instead, in the background.
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(entry.proc.pid), '/T', '/F'], { windowsHide: true }, () => undefined)
    return
  }
  try {
    entry.proc.kill()
  } catch {
    // Already gone.
  }
}

export function killAll(): void {
  for (const id of [...running.keys()]) kill(id)
}
