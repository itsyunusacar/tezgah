import { execFile } from 'node:child_process'
import type { PullRequest } from '../shared/types'
import { currentBranch } from './git'

// What the sidebar shows next to a session: listening ports of its processes and the branch's PR.

function run(cmd: string, args: string[], cwd?: string, timeout = 8000): Promise<string> {
  return new Promise((resolve) =>
    execFile(cmd, args, { cwd, timeout, maxBuffer: 8 << 20, windowsHide: true }, (err, stdout) => resolve(err ? '' : stdout)),
  )
}

// Ports

/** "pid ppid" lines (ps) → children of each pid. */
export function parseProcessTree(text: string): Map<number, number[]> {
  const children = new Map<number, number[]>()
  for (const line of text.split('\n')) {
    const [pid, ppid] = line.trim().split(/[\s,]+/).map(Number)
    if (!pid || Number.isNaN(ppid)) continue
    children.set(ppid, [...(children.get(ppid) ?? []), pid])
  }
  return children
}

export function descendants(tree: Map<number, number[]>, root: number): Set<number> {
  const out = new Set<number>([root])
  const stack = [root]
  while (stack.length) {
    for (const c of tree.get(stack.pop()!) ?? []) {
      if (!out.has(c)) {
        out.add(c)
        stack.push(c)
      }
    }
  }
  return out
}

/** `lsof -nP -iTCP -sTCP:LISTEN -Fpn` → pid → ports. */
export function parseLsof(text: string): Map<number, number[]> {
  const ports = new Map<number, number[]>()
  let pid = 0
  for (const line of text.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1))
    else if (line.startsWith('n') && pid) {
      const port = Number(line.slice(line.lastIndexOf(':') + 1))
      if (port) ports.set(pid, [...new Set([...(ports.get(pid) ?? []), port])])
    }
  }
  return ports
}

/** `ss -ltnpH` (Linux without lsof) → pid → ports. */
export function parseSs(text: string): Map<number, number[]> {
  const ports = new Map<number, number[]>()
  for (const line of text.split('\n')) {
    const cols = line.trim().split(/\s+/)
    const local = cols[3]
    if (!local) continue
    const port = Number(local.slice(local.lastIndexOf(':') + 1))
    for (const m of line.matchAll(/pid=(\d+)/g)) {
      const pid = Number(m[1])
      if (port) ports.set(pid, [...new Set([...(ports.get(pid) ?? []), port])])
    }
  }
  return ports
}

/** `netstat -ano -p TCP` (Windows) → pid → ports. */
export function parseNetstat(text: string): Map<number, number[]> {
  const ports = new Map<number, number[]>()
  for (const line of text.split('\n')) {
    const cols = line.trim().split(/\s+/)
    if (cols[0] !== 'TCP' || cols[3] !== 'LISTENING') continue
    const port = Number(cols[1].slice(cols[1].lastIndexOf(':') + 1))
    const pid = Number(cols[4])
    if (port && pid) ports.set(pid, [...new Set([...(ports.get(pid) ?? []), port])])
  }
  return ports
}

let snapshot: { at: number; tree: Map<number, number[]>; ports: Map<number, number[]> } | undefined

async function system(): Promise<NonNullable<typeof snapshot>> {
  if (snapshot && Date.now() - snapshot.at < 3000) return snapshot
  let tree: Map<number, number[]>
  let ports: Map<number, number[]>
  if (process.platform === 'win32') {
    const [procs, net] = await Promise.all([
      run('powershell.exe', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }'], undefined, 15000),
      run('netstat', ['-ano', '-p', 'TCP']),
    ])
    tree = parseProcessTree(procs)
    ports = parseNetstat(net)
  } else {
    const [procs, lsof] = await Promise.all([run('ps', ['-A', '-o', 'pid=,ppid=']), run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn'])])
    tree = parseProcessTree(procs)
    ports = lsof ? parseLsof(lsof) : parseSs(await run('ss', ['-ltnpH']))
  }
  snapshot = { at: Date.now(), tree, ports }
  return snapshot
}

/** Ports listened on by `pid` or anything it started (dev servers, previews…). */
export async function listeningPorts(pid: number): Promise<number[]> {
  const { tree, ports } = await system()
  const out = new Set<number>()
  for (const p of descendants(tree, pid)) for (const port of ports.get(p) ?? []) out.add(port)
  return [...out].sort((a, b) => a - b)
}

// Pull requests, through the GitHub CLI when it is installed and signed in. Cached: gh is slow.

const prCache = new Map<string, { at: number; pr: PullRequest | null }>()

export async function pullRequest(cwd: string): Promise<PullRequest | null> {
  const branch = await currentBranch(cwd).catch(() => '')
  if (!branch || branch === 'HEAD') return null
  const key = `${cwd}\0${branch}`
  const hit = prCache.get(key)
  if (hit && Date.now() - hit.at < 120_000) return hit.pr
  prCache.set(key, { at: Date.now(), pr: hit?.pr ?? null })
  const out = await run('gh', ['pr', 'view', '--json', 'number,state,url,isDraft,title'], cwd, 15000)
  let pr: PullRequest | null = null
  try {
    const j = JSON.parse(out)
    pr = { number: j.number, url: j.url, title: j.title, state: j.isDraft ? 'draft' : String(j.state).toLowerCase() as PullRequest['state'] }
  } catch {
    // No PR for this branch, gh missing or signed out.
  }
  prCache.set(key, { at: Date.now(), pr })
  return pr
}

export async function sessionMeta(cwd: string, pids: number[]): Promise<{ branch?: string; ports: number[]; pr: PullRequest | null }> {
  const [branch, ports, pr] = await Promise.all([
    currentBranch(cwd).catch(() => undefined),
    Promise.all(pids.map(listeningPorts)).then((l) => [...new Set(l.flat())].sort((a, b) => a - b)),
    pullRequest(cwd),
  ])
  return { branch: branch && branch !== 'HEAD' ? branch : undefined, ports, pr }
}
