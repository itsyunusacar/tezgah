import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import type { RecentConversation, SubAgent, UsageLimit } from '../shared/types'

/** Claude Code's data folder (respects CLAUDE_CONFIG_DIR). */
function claudeDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
}

function projectsDir(): string {
  return path.join(claudeDir(), 'projects')
}

function listDirs(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return []
  }
}

/** Claude Code writes each conversation to projects/<encoded cwd>/<id>.jsonl. */
export function conversationFile(id: string): string | undefined {
  for (const dir of listDirs(projectsDir())) {
    const file = path.join(projectsDir(), dir, `${id}.jsonl`)
    if (fs.existsSync(file)) return file
  }
  return undefined
}

// Subagents: projects/<project>/<conversation>/subagents/agent-<id>.meta.json, transcript next to it.

interface Progress {
  offset: number
  remainder: string
  tools: number
  activity?: string
}
const progress = new Map<string, Progress>()

/** "Read app.tsx", "Bash npm test", "Grep "useTheme"". */
export function toolSummary(name: string, input: Record<string, unknown>): string {
  let detail = ''
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : undefined)
  if (str('command')) detail = str('command')!
  else if (str('file_path') || str('notebook_path')) detail = path.basename((str('file_path') ?? str('notebook_path'))!)
  else if (str('pattern')) detail = `"${str('pattern')}"`
  else detail = ['url', 'query', 'description', 'prompt', 'path'].map(str).find(Boolean) ?? ''
  detail = detail.replace(/\s+/g, ' ').trim()
  if (detail.length > 80) detail = detail.slice(0, 80) + '…'
  return detail ? `${name} ${detail}` : name
}

/** Reads what was appended to a transcript since the last call, counting tool uses. */
function readNew(file: string): Progress {
  const p = progress.get(file) ?? { offset: 0, remainder: '', tools: 0 }
  try {
    const size = fs.statSync(file).size
    if (size > p.offset) {
      const fd = fs.openSync(file, 'r')
      const len = Math.min(size - p.offset, 32 << 20)
      const buf = Buffer.alloc(len)
      fs.readSync(fd, buf, 0, len, p.offset)
      fs.closeSync(fd)
      p.offset += len
      const text = p.remainder + buf.toString('utf8')
      const end = text.lastIndexOf('\n')
      p.remainder = end < 0 ? text : text.slice(end + 1)
      for (const line of end < 0 ? [] : text.slice(0, end).split('\n')) {
        try {
          const obj = JSON.parse(line)
          if (obj.type !== 'assistant') continue
          for (const item of obj.message?.content ?? []) {
            if (item.type !== 'tool_use') continue
            p.tools += 1
            p.activity = toolSummary(item.name ?? 'Tool', item.input ?? {})
          }
        } catch {
          // A partial or foreign line; skip it.
        }
      }
    }
  } catch {
    // The transcript may not exist yet.
  }
  progress.set(file, p)
  return p
}

export function subagents(claudeId: string): SubAgent[] {
  const now = Date.now()
  for (const dir of listDirs(projectsDir())) {
    const folder = path.join(projectsDir(), dir, claudeId, 'subagents')
    if (!fs.existsSync(folder)) continue
    const out: SubAgent[] = []
    for (const name of fs.readdirSync(folder)) {
      if (!name.endsWith('.meta.json')) continue
      const id = name.slice(0, -'.meta.json'.length)
      const metaFile = path.join(folder, name)
      const transcript = path.join(folder, `${id}.jsonl`)
      try {
        const metaTime = fs.statSync(metaFile).mtimeMs
        const transcriptTime = fs.existsSync(transcript) ? fs.statSync(transcript).mtimeMs : metaTime
        const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'))
        const finished = meta.finished === true
        // Finished agents linger for a minute; running ones must have written recently.
        if (finished && now - metaTime > 60_000) continue
        if (!finished && now - transcriptTime > 15 * 60_000) continue
        const p = readNew(transcript)
        out.push({
          id,
          type: meta.agentType ?? 'agent',
          description: meta.description ?? id,
          activity: p.activity,
          running: !finished,
          toolUses: p.tools,
          updatedAt: Math.max(metaTime, transcriptTime),
        })
      } catch {
        // Being written; next poll.
      }
    }
    return out.sort((a, b) => a.updatedAt - b.updatedAt)
  }
  return []
}

/** Recent conversations across all projects, newest first, with their first prompt. */
export function recentConversations(limit = 60): RecentConversation[] {
  const items: { file: string; mtime: number }[] = []
  for (const dir of listDirs(projectsDir())) {
    const full = path.join(projectsDir(), dir)
    for (const name of fs.readdirSync(full)) {
      if (!name.endsWith('.jsonl')) continue
      try {
        items.push({ file: path.join(full, name), mtime: fs.statSync(path.join(full, name)).mtimeMs })
      } catch {
        // Gone.
      }
    }
  }
  items.sort((a, b) => b.mtime - a.mtime)
  const out: RecentConversation[] = []
  for (const { file, mtime } of items.slice(0, limit * 2)) {
    let cwd = ''
    let prompt = ''
    try {
      const fd = fs.openSync(file, 'r')
      const buf = Buffer.alloc(256 << 10)
      const n = fs.readSync(fd, buf, 0, buf.length, 0)
      fs.closeSync(fd)
      for (const line of buf.toString('utf8', 0, n).split('\n')) {
        try {
          const obj = JSON.parse(line)
          if (!cwd && typeof obj.cwd === 'string') cwd = obj.cwd
          if (!prompt && obj.type === 'user' && !obj.isMeta) {
            const c = obj.message?.content
            const text = typeof c === 'string' ? c : Array.isArray(c) ? c.find((x: any) => x.type === 'text')?.text : ''
            if (text && !text.startsWith('<')) prompt = text.replace(/\s+/g, ' ').slice(0, 140)
          }
          if (cwd && prompt) break
        } catch {
          // Truncated line at the end of the buffer.
        }
      }
    } catch {
      continue
    }
    if (!prompt) continue
    out.push({ id: path.basename(file, '.jsonl'), cwd, prompt, updatedAt: mtime })
    if (out.length >= limit) break
  }
  return out
}

// Usage limits: the same endpoint Claude Code's /usage uses. Undocumented; may change.

function run(file: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) =>
    execFile(file, args, { timeout: 5000 }, (err, stdout) => resolve(err ? undefined : stdout.trim())),
  )
}

async function accessToken(): Promise<string | undefined> {
  const parse = (json?: string) => {
    try {
      return json ? (JSON.parse(json).claudeAiOauth?.accessToken as string | undefined) : undefined
    } catch {
      return undefined
    }
  }
  if (process.platform === 'darwin') {
    const token = parse(await run('/usr/bin/security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w']))
    if (token) return token
  }
  try {
    return parse(fs.readFileSync(path.join(claudeDir(), '.credentials.json'), 'utf8'))
  } catch {
    return undefined
  }
}

export async function usage(): Promise<UsageLimit[] | null> {
  const token = await accessToken()
  if (!token) return null
  try {
    const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return null
    return parseUsage(await res.json())
  } catch {
    return null
  }
}

export function parseUsage(obj: any): UsageLimit[] {
  const time = (v: unknown) => (typeof v === 'string' ? Date.parse(v) || undefined : undefined)
  if (Array.isArray(obj?.limits) && obj.limits.length) {
    return obj.limits
      .filter((l: any) => l.is_active !== false)
      .map((l: any) => {
        const model = l.scope?.model?.display_name as string | undefined
        const label =
          l.kind === 'session' ? '5h' : model ? `Week · ${model}` : String(l.kind ?? '').startsWith('weekly') ? 'Week' : l.kind
        return { label, percent: Number(l.percent ?? 0), resetsAt: time(l.resets_at) }
      })
  }
  const out: UsageLimit[] = []
  for (const [key, label] of [['five_hour', '5h'], ['seven_day', 'Week']] as const) {
    const b = obj?.[key]
    if (b) out.push({ label, percent: Number(b.utilization ?? 0), resetsAt: time(b.resets_at) })
  }
  return out
}
