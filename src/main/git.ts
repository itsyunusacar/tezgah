import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { Diff, FileChange, Worktree } from '../shared/types'

/** For commits, pushes and merges: hooks, signing and the network can take minutes. */
const LONG = 10 * 60_000

/** Nothing can answer a credential prompt here: fail instead of waiting unseen. */
const noPrompt = () => ({ ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GH_PROMPT_DISABLED: '1' })

function git(cwd: string, args: string[], timeout = 20_000): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(
      'git',
      // Paths as they are (çalışma.md, not "\303\247…").
      ['-c', 'core.quotePath=false', ...args],
      { cwd, maxBuffer: 32 << 20, timeout, env: noPrompt() },
      (err, stdout, stderr) => (err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout)),
    ),
  )
}

export async function isRepo(cwd: string): Promise<boolean> {
  try {
    return (await git(cwd, ['rev-parse', '--is-inside-work-tree'])).trim() === 'true'
  } catch {
    return false
  }
}

export async function currentBranch(cwd: string): Promise<string> {
  return (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
}

// Parsers for -z output: every field ends with NUL; renames and copies carry the old and the new path.

/** `diff --name-status -z` → path (the new one for renames) → status. */
export function parseNameStatus(out: string): Map<string, FileChange['status']> {
  const files = new Map<string, FileChange['status']>()
  const f = out.split('\0')
  for (let i = 0; i < f.length; i++) {
    const code = f[i][0]
    if (!code) continue
    const file = code === 'R' || code === 'C' ? f[(i += 2)] : f[++i]
    if (file === undefined) break
    files.set(file, code === 'C' ? 'A' : code === 'A' || code === 'D' || code === 'R' ? code : 'M')
  }
  return files
}

/** `diff --numstat -z` → path (the new one for renames) → lines added and removed (binary files: 0). */
export function parseNumstat(out: string): Map<string, { added: number; removed: number }> {
  const stats = new Map<string, { added: number; removed: number }>()
  const f = out.split('\0')
  for (let i = 0; i < f.length; i++) {
    const m = f[i].match(/^(-|\d+)\t(-|\d+)\t([^]*)$/)
    if (!m) continue
    // A rename leaves the path empty; the old and new paths are the next two fields.
    const file = m[3] || f[(i += 2)]
    if (file !== undefined) stats.set(file, { added: Number(m[1]) || 0, removed: Number(m[2]) || 0 })
  }
  return stats
}

/** A C-quoted path from a diff header ("a/x\ty", octal escapes for UTF-8 bytes) → the path. */
export function unquote(s: string): string {
  if (!s.startsWith('"')) return s
  const esc: Record<string, number> = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11 }
  const bytes: number[] = []
  for (let i = 1; i < s.length - 1; i++) {
    if (s[i] !== '\\') {
      bytes.push(...Buffer.from(s[i]))
      continue
    }
    const n = s[++i]
    if (/[0-7]/.test(n)) {
      bytes.push(parseInt(s.slice(i, i + 3), 8))
      i += 2
    } else bytes.push(esc[n] ?? n.charCodeAt(0))
  }
  return Buffer.from(bytes).toString('utf8')
}

/** The (new) path a chunk of `git diff` is about. */
export function patchPath(chunk: string): string | undefined {
  const to = chunk.match(/^(?:rename|copy) to (.*)$/m)
  if (to) return unquote(to[1])
  const nl = chunk.indexOf('\n')
  const head = (nl < 0 ? chunk : chunk.slice(0, nl)).replace(/^diff --git /, '')
  const quoted = head.match(/ ("b\/(?:[^"\\]|\\.)*")$/)
  if (quoted) return unquote(quoted[1]).slice(2)
  // "a/<p> b/<p>": the same path twice, so spaces in it can't mislead.
  const n = (head.length - 5) / 2
  if (Number.isInteger(n) && n > 0 && head.slice(2, 2 + n) === head.slice(-n)) return head.slice(-n)
  return head.match(/ b\/(.*)$/)?.[1]
}

interface Untracked {
  mtime: number
  size: number
  change: FileChange
  patch: string
}

/** Untracked files as last read, per repo: unchanged ones (same mtime and size) aren't read again. */
const untrackedCache = new Map<string, Map<string, Untracked>>()

async function readUntracked(cwd: string, file: string, prev?: Untracked): Promise<Untracked | undefined> {
  const abs = path.join(cwd, file)
  const st = await fs.promises.stat(abs).catch(() => undefined)
  if (!st?.isFile()) return undefined
  if (prev && prev.mtime === st.mtimeMs && prev.size === st.size) return prev
  const entry = (added: number, patch: string): Untracked => ({ mtime: st.mtimeMs, size: st.size, change: { path: file, status: 'U', added, removed: 0 }, patch })
  // Too big to show: listed without lines.
  if (st.size > 512 << 10) return entry(0, `diff --git a/${file} b/${file}\nnew file\n`)
  const buf = await fs.promises.readFile(abs).catch(() => undefined)
  if (!buf) return undefined
  if (buf.subarray(0, 8000).includes(0)) return entry(0, `diff --git a/${file} b/${file}\nBinary file\n`)
  const text = buf.toString('utf8')
  const lines = text ? text.replace(/\n$/, '').split('\n') : []
  return entry(lines.length, `diff --git a/${file} b/${file}\nnew file\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => '+' + l).join('\n')}\n`)
}

/** Changes in `cwd`: against `base` (a worktree's base branch) or, without one, uncommitted. */
export async function diff(cwd: string, base?: string): Promise<Diff | null> {
  if (!(await isRepo(cwd))) return null
  const range = base ? [(await git(cwd, ['merge-base', base, 'HEAD'])).trim()] : ['HEAD']
  const files = new Map<string, FileChange>()
  const patches: Record<string, string> = {}

  const [nameStatus, numstat, full, untracked] = await Promise.all([
    git(cwd, ['diff', '--name-status', '-z', ...range]).catch(() => ''),
    git(cwd, ['diff', '--numstat', '-z', ...range]).catch(() => ''),
    git(cwd, ['diff', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', ...range]).catch(() => ''),
    git(cwd, ['ls-files', '--others', '--exclude-standard', '-z']).catch(() => ''),
  ])
  const stats = parseNumstat(numstat)
  for (const [file, status] of parseNameStatus(nameStatus)) {
    files.set(file, { path: file, status, added: 0, removed: 0, ...stats.get(file) })
  }
  for (const chunk of full.split(/^(?=diff --git )/m).filter(Boolean)) {
    const file = patchPath(chunk)
    if (file) patches[file] = chunk
  }

  // Untracked files count as added (big and binary ones without lines), read a few at a time.
  const prev = untrackedCache.get(cwd)
  const seen = new Map<string, Untracked>()
  const list = untracked.split('\0').filter(Boolean).slice(0, 200)
  for (let i = 0; i < list.length; i += 16) {
    for (const u of await Promise.all(list.slice(i, i + 16).map((f) => readUntracked(cwd, f, prev?.get(f))))) {
      if (u) seen.set(u.change.path, u)
    }
  }
  untrackedCache.set(cwd, seen)
  for (const [file, u] of seen) {
    files.set(file, u.change)
    patches[file] = u.patch
  }
  return { files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)), patches, against: base ?? 'HEAD' }
}

/** A new branch in `<repo>.worktrees/<branch>`, next to the repo. */
export async function worktreeAdd(repo: string, branch: string): Promise<Worktree> {
  const root = (await git(repo, ['rev-parse', '--show-toplevel'])).trim()
  const base = await currentBranch(root)
  const safe = branch.replace(/[^A-Za-z0-9._/-]+/g, '-').replace(/^-+|-+$/g, '') || 'session'
  const dir = path.join(path.dirname(root), `${path.basename(root)}.worktrees`, safe.replace(/\//g, '-'))
  fs.mkdirSync(path.dirname(dir), { recursive: true })
  await git(root, ['worktree', 'add', '-b', safe, dir, base], LONG)
  return { branch: safe, path: dir, base }
}

export async function worktreeRemove(repo: string, wt: Worktree, deleteBranch: boolean): Promise<void> {
  await git(repo, ['worktree', 'remove', '--force', wt.path], LONG).catch(() => undefined)
  if (deleteBranch) await git(repo, ['branch', '-D', wt.branch]).catch(() => undefined)
}

/** Merges the worktree's branch into its base in the main checkout. Returns git's summary. */
export async function worktreeMerge(repo: string, wt: Worktree): Promise<string> {
  const root = (await git(repo, ['rev-parse', '--show-toplevel'])).trim()
  if ((await git(root, ['status', '--porcelain'])).trim()) throw new Error(`${path.basename(root)} has uncommitted changes.`)
  if ((await git(wt.path, ['status', '--porcelain'])).trim()) {
    throw new Error(`The worktree has uncommitted changes. Ask the agent to commit them first.`)
  }
  if ((await currentBranch(root)) !== wt.base) await git(root, ['checkout', wt.base], LONG)
  return (await git(root, ['merge', '--no-ff', '--no-edit', wt.branch], LONG)).trim()
}

// Committing, pushing and opening a pull request from the Changes panel.

export interface RepoStatus {
  branch: string
  /** Uncommitted changes (tracked or new files). */
  dirty: boolean
  /** Commits not on the upstream yet; null when the branch has no upstream. */
  ahead: number | null
  /** The repo has a remote named origin. */
  remote: boolean
  /** The repo's default branch (main, master…), where a pull request makes no sense. */
  defaultBranch?: string
}

export async function status(cwd: string): Promise<RepoStatus | null> {
  if (!(await isRepo(cwd))) return null
  const [branch, porcelain, remotes] = await Promise.all([
    currentBranch(cwd).catch(() => 'HEAD'),
    git(cwd, ['status', '--porcelain']).catch(() => ''),
    git(cwd, ['remote']).catch(() => ''),
  ])
  const ahead = await git(cwd, ['rev-list', '--count', '@{upstream}..HEAD']).then((n) => Number(n.trim()), () => null)
  const head = await git(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).then((r) => r.trim().replace(/^origin\//, ''), () => undefined)
  return { branch, dirty: porcelain.trim().length > 0, ahead, remote: remotes.split('\n').includes('origin'), defaultBranch: head }
}

/** Stages everything and commits; returns the new commit's short hash. */
export async function commit(cwd: string, message: string): Promise<string> {
  if (!message.trim()) throw new Error('Write a commit message first.')
  await git(cwd, ['add', '-A'], LONG)
  await git(cwd, ['commit', '-m', message.trim()], LONG)
  return (await git(cwd, ['rev-parse', '--short', 'HEAD'])).trim()
}

/** Pushes the current branch to origin, setting it as the upstream the first time. */
export async function push(cwd: string): Promise<void> {
  await git(cwd, ['push', '-u', 'origin', 'HEAD'], LONG)
}

/** Opens a pull request for the current branch with the GitHub CLI; returns its URL. */
export function createPr(cwd: string): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile('gh', ['pr', 'create', '--fill'], { cwd, timeout: LONG, env: noPrompt() }, (err, stdout, stderr) => {
      if (err) {
        const missing = (err as NodeJS.ErrnoException).code === 'ENOENT'
        return reject(new Error(missing ? 'Install the GitHub CLI (gh) and sign in to open pull requests.' : (stderr || err.message).trim()))
      }
      resolve(stdout.trim().split('\n').pop() ?? '')
    }),
  )
}
