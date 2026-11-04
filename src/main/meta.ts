import { execFile } from 'node:child_process'
import type { PullRequest } from '../shared/types'
import { currentBranch } from './git'
import { signedIn as claudeSignedIn } from './claude'

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

interface Snapshot {
  tree: Map<number, number[]>
  ports: Map<number, number[]>
}

/** One scan of processes and listening sockets shared by every session, at most every 15 s. */
let scan: { at: number; done: Promise<Snapshot> } | undefined

function system(): Promise<Snapshot> {
  if (!scan || Date.now() - scan.at >= 15_000) scan = { at: Date.now(), done: scanSystem() }
  return scan.done
}

async function scanSystem(): Promise<Snapshot> {
  if (process.platform === 'win32') {
    const [procs, net] = await Promise.all([
      run('powershell.exe', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }'], undefined, 15000),
      run('netstat', ['-ano', '-p', 'TCP']),
    ])
    return { tree: parseProcessTree(procs), ports: parseNetstat(net) }
  }
  const [procs, lsof] = await Promise.all([run('ps', ['-A', '-o', 'pid=,ppid=']), run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn'])])
  return { tree: parseProcessTree(procs), ports: lsof ? parseLsof(lsof) : parseSs(await run('ss', ['-ltnpH'])) }
}

/** Ports listened on by `pid` or anything it started (dev servers, previews…). */
export async function listeningPorts(pid: number): Promise<number[]> {
  const { tree, ports } = await system()
  const out = new Set<number>()
  for (const p of descendants(tree, pid)) for (const port of ports.get(p) ?? []) out.add(port)
  return [...out].sort((a, b) => a - b)
}

/** The branch checked out in `cwd`, asked once per round for the sessions that share it. */
const branches = new Map<string, { at: number; done: Promise<string | undefined> }>()

function branchOf(cwd: string): Promise<string | undefined> {
  const hit = branches.get(cwd)
  if (hit && Date.now() - hit.at < 2000) return hit.done
  const done = currentBranch(cwd).then((b) => (b && b !== 'HEAD' ? b : undefined), () => undefined)
  branches.set(cwd, { at: Date.now(), done })
  return done
}

// Pull requests, through the GitHub CLI when it is installed and signed in. Cached: gh is slow.

const prCache = new Map<string, { at: number; pr: PullRequest | null }>()

export async function pullRequest(cwd: string, branch: string | undefined): Promise<PullRequest | null> {
  if (!branch) return null
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
  const branch = branchOf(cwd)
  const [ports, pr] = await Promise.all([
    Promise.all(pids.map(listeningPorts)).then((l) => [...new Set(l.flat())].sort((a, b) => a - b)),
    branch.then((b) => pullRequest(cwd, b)),
  ])
  return { branch: await branch, ports, pr }
}

// The tools Tezgah works with, for the welcome screen's checklist.

export interface Tools {
  claude?: string
  signedIn: boolean
  git?: string
  gh?: string
}

const version = (out: string) => out.match(/\d+\.\d+(\.\d+)?/)?.[0]

export async function tools(): Promise<Tools> {
  const shell = process.platform === 'win32'
  const ask = (cmd: string) => run(shell ? `${cmd}.cmd` : cmd, ['--version']).then((o) => o || (shell ? run(cmd, ['--version']) : ''))
  const [claude, git, gh, signedIn] = await Promise.all([ask('claude'), run('git', ['--version']), run('gh', ['--version']), claudeSignedIn()])
  return { claude: version(claude), git: version(git), gh: version(gh), signedIn }
}
