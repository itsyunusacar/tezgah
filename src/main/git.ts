import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { Diff, FileChange, Worktree } from '../shared/types'

function git(cwd: string, args: string[], maxBuffer = 32 << 20): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile('git', args, { cwd, maxBuffer, timeout: 20_000 }, (err, stdout, stderr) =>
      err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout),
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

/** Changes in `cwd`: against `base` (a worktree's base branch) or, without one, uncommitted. */
export async function diff(cwd: string, base?: string): Promise<Diff | null> {
  if (!(await isRepo(cwd))) return null
  const range = base ? [(await git(cwd, ['merge-base', base, 'HEAD'])).trim()] : ['HEAD']
  const files = new Map<string, FileChange>()
  const patches: Record<string, string> = {}

  const numstat = await git(cwd, ['diff', '--numstat', ...range]).catch(() => '')
  const nameStatus = await git(cwd, ['diff', '--name-status', ...range]).catch(() => '')
  for (const line of nameStatus.split('\n').filter(Boolean)) {
    const [status, ...rest] = line.split('\t')
    const file = rest[rest.length - 1]
    files.set(file, { path: file, status: (status[0] as FileChange['status']) ?? 'M', added: 0, removed: 0 })
  }
  for (const line of numstat.split('\n').filter(Boolean)) {
    const [a, r, ...rest] = line.split('\t')
    const file = rest.join('\t').replace(/.*=> /, '').replace(/[{}]/g, '')
    const entry = files.get(file)
    if (entry) {
      entry.added = Number(a) || 0
      entry.removed = Number(r) || 0
    }
  }
  const full = await git(cwd, ['diff', '--no-color', '--no-ext-diff', ...range]).catch(() => '')
  for (const chunk of full.split(/^(?=diff --git )/m).filter(Boolean)) {
    const m = chunk.match(/^diff --git a\/.* b\/(.*)$/m)
    if (m) patches[m[1]] = chunk
  }

  // Untracked files count as added (skipping big ones).
  const untracked = await git(cwd, ['ls-files', '--others', '--exclude-standard']).catch(() => '')
  for (const file of untracked.split('\n').filter(Boolean).slice(0, 200)) {
    const abs = path.join(cwd, file)
    let buf: Buffer | undefined
    try {
      if (fs.statSync(abs).size <= 512 << 10) buf = fs.readFileSync(abs)
    } catch {
      continue
    }
    if (buf && buf.subarray(0, 8000).includes(0)) {
      files.set(file, { path: file, status: 'U', added: 0, removed: 0 })
      patches[file] = `diff --git a/${file} b/${file}\nBinary file\n`
      continue
    }
    const text = buf?.toString('utf8') ?? ''
    const lines = text ? text.replace(/\n$/, '').split('\n') : []
    files.set(file, { path: file, status: 'U', added: lines.length, removed: 0 })
    patches[file] = `diff --git a/${file} b/${file}\nnew file\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => '+' + l).join('\n')}\n`
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
  await git(root, ['worktree', 'add', '-b', safe, dir, base])
  return { branch: safe, path: dir, base }
}

export async function worktreeRemove(repo: string, wt: Worktree, deleteBranch: boolean): Promise<void> {
  await git(repo, ['worktree', 'remove', '--force', wt.path]).catch(() => undefined)
  if (deleteBranch) await git(repo, ['branch', '-D', wt.branch]).catch(() => undefined)
}

/** Merges the worktree's branch into its base in the main checkout. Returns git's summary. */
export async function worktreeMerge(repo: string, wt: Worktree): Promise<string> {
  const root = (await git(repo, ['rev-parse', '--show-toplevel'])).trim()
  if ((await git(root, ['status', '--porcelain'])).trim()) throw new Error(`${path.basename(root)} has uncommitted changes.`)
  if ((await git(wt.path, ['status', '--porcelain'])).trim()) {
    throw new Error(`The worktree has uncommitted changes. Ask the agent to commit them first.`)
  }
  if ((await currentBranch(root)) !== wt.base) await git(root, ['checkout', wt.base])
  return (await git(root, ['merge', '--no-ff', '--no-edit', wt.branch])).trim()
}
