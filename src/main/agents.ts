import { execFile } from 'node:child_process'
import path from 'node:path'

// Which coding agent, if any, runs in the foreground of each terminal. Agents other than Claude Code
// don't report their state, so the renderer watches their output instead (see activity.ts); this
// tells it which panes to watch. One `ps` for all panes every couple of seconds; macOS and Linux.

/** Command names of terminal agents (Claude Code reports its own state and isn't listed). */
const AGENTS = ['grok', 'gemini', 'codex', 'aider', 'opencode', 'amp', 'goose', 'cursor-agent', 'kiro-cli', 'qwen', 'crush', 'droid', 'copilot', 'cline', 'agy', 'kimi', 'auggie']
const RUNTIMES = new Set(['node', 'bun', 'deno', 'python', 'python3', 'npx', 'uv', 'uvx', 'pipx', 'sh', 'bash', 'zsh', 'dash'])

/** The agent a command line runs: `grok`, `/opt/bin/grok-macos-aarch64`, `node …/gemini.js` → its name. */
export function agentOf(args: string): string | undefined {
  const words = args.trim().split(/\s+/)
  for (let i = 0; i < Math.min(words.length, 3); i++) {
    const base = path.basename(words[i]).replace(/\.(m?js|cjs|py|exe)$/, '').toLowerCase()
    const hit = AGENTS.find((a) => base === a || base.startsWith(a + '-'))
    if (hit) return hit
    if (!RUNTIMES.has(base.replace(/[\d.]+$/, ''))) return undefined
  }
  return undefined
}

/** `ps -A -o tty=,stat=,args=` → the foreground agent on each terminal ("ttys012", "pts/3"). */
export function agentsByTty(ps: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const line of ps.split('\n')) {
    const m = line.trim().match(/^(\S+)\s+(\S+)\s+(.*)$/)
    if (!m || !m[2].includes('+')) continue
    const agent = agentOf(m[3])
    if (agent) out.set(m[1], agent)
  }
  return out
}

export function scan(): Promise<Map<string, string>> {
  return new Promise((resolve) =>
    execFile('ps', ['-A', '-o', 'tty=,stat=,args='], { timeout: 5000, maxBuffer: 8 << 20 }, (err, stdout) =>
      resolve(err ? new Map() : agentsByTty(stdout)),
    ),
  )
}

/** "/dev/ttys012" → "ttys012", "/dev/pts/3" → "pts/3", as ps prints them. */
export const ttyName = (dev: string) => dev.replace(/^\/dev\//, '')
