import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import type { ConversationStats, ProviderUsage, RecentConversation, SubAgent, TranscriptEntry, UsageLimit } from '../shared/types'

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
          claudeId,
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

/** Turns transcript lines into what a person reads: the task, Claude's words, its tool calls and their results. */
export function parseTranscript(lines: string[]): TranscriptEntry[] {
  const out: TranscriptEntry[] = []
  const clip = (t: string, n: number) => (t.length > n ? t.slice(0, n) + '…' : t)
  for (const line of lines) {
    let obj
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }
    const content = obj.message?.content
    const at = obj.timestamp ? Date.parse(obj.timestamp) : undefined
    if (obj.type === 'user') {
      if (typeof content === 'string') out.push({ kind: 'prompt', text: clip(content.trim(), 4000), at })
      else
        for (const item of content ?? []) {
          if (item.type === 'text' && item.text?.trim()) out.push({ kind: 'prompt', text: clip(item.text.trim(), 4000), at })
          if (item.type === 'tool_result') {
            const raw = typeof item.content === 'string' ? item.content : (item.content ?? []).map((c: { text?: string }) => c.text ?? '').join('\n')
            const lines = String(raw).trim().split('\n')
            const text = lines.slice(0, 6).join('\n') + (lines.length > 6 ? `\n… ${lines.length - 6} more lines` : '')
            out.push({ kind: item.is_error ? 'error' : 'result', text: clip(text, 1200), at })
          }
        }
    } else if (obj.type === 'assistant') {
      for (const item of content ?? []) {
        if (item.type === 'text' && item.text?.trim()) out.push({ kind: 'text', text: clip(item.text.trim(), 4000), at })
        if (item.type === 'tool_use') out.push({ kind: 'tool', text: toolSummary(item.name ?? 'Tool', item.input ?? {}), at })
      }
    }
  }
  return out
}

/** A subagent's transcript, its last few hundred steps. */
export function agentTranscript(claudeId: string, agentId: string): TranscriptEntry[] {
  if (!/^[\w-]+$/.test(claudeId) || !/^[\w-]+$/.test(agentId)) return []
  for (const dir of listDirs(projectsDir())) {
    const file = path.join(projectsDir(), dir, claudeId, 'subagents', `${agentId}.jsonl`)
    if (!fs.existsSync(file)) continue
    try {
      const size = fs.statSync(file).size
      const start = Math.max(0, size - (4 << 20))
      const fd = fs.openSync(file, 'r')
      const buf = Buffer.alloc(size - start)
      fs.readSync(fd, buf, 0, buf.length, start)
      fs.closeSync(fd)
      const lines = buf.toString('utf8').split('\n')
      if (start > 0) lines.shift()
      return parseTranscript(lines).slice(-400)
    } catch {
      return []
    }
  }
  return []
}

// Token use per conversation, read incrementally from its transcript. A message can span several lines
// (one per content block) with the same usage, so each message id counts once.

interface Tally {
  offset: number
  remainder: string
  seen: Set<string>
  stats: ConversationStats
}
const tallies = new Map<string, Tally>()

/** Adds the usage in transcript lines to a running tally. */
export function tallyLines(lines: string[], seen: Set<string>, stats: ConversationStats): ConversationStats {
  for (const line of lines) {
    if (!line.includes('"usage"')) continue
    let obj
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }
    const m = obj.message
    const u = m?.usage
    if (obj.type !== 'assistant' || !u) continue
    const id = m.id ?? obj.uuid
    if (id && seen.has(id)) continue
    if (id) seen.add(id)
    const input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
    stats.input += input
    stats.output += u.output_tokens ?? 0
    stats.cacheRead += u.cache_read_input_tokens ?? 0
    stats.messages += 1
    // What the model saw last time is how full the context is now.
    stats.context = input + (u.output_tokens ?? 0)
    if (m.model && !String(m.model).startsWith('<')) stats.model = m.model
  }
  return stats
}

export function conversationStats(claudeId: string): ConversationStats | null {
  const file = conversationFile(claudeId)
  if (!file) return null
  const t = tallies.get(file) ?? { offset: 0, remainder: '', seen: new Set(), stats: { input: 0, output: 0, cacheRead: 0, context: 0, messages: 0 } }
  try {
    const size = fs.statSync(file).size
    if (size < t.offset) Object.assign(t, { offset: 0, remainder: '', seen: new Set(), stats: { input: 0, output: 0, cacheRead: 0, context: 0, messages: 0 } })
    if (size > t.offset) {
      const fd = fs.openSync(file, 'r')
      const len = Math.min(size - t.offset, 64 << 20)
      const buf = Buffer.alloc(len)
      fs.readSync(fd, buf, 0, len, t.offset)
      fs.closeSync(fd)
      t.offset += len
      const text = t.remainder + buf.toString('utf8')
      const end = text.lastIndexOf('\n')
      t.remainder = end < 0 ? text : text.slice(end + 1)
      if (end >= 0) tallyLines(text.slice(0, end).split('\n'), t.seen, t.stats)
    }
  } catch {
    return null
  }
  tallies.set(file, t)
  return { ...t.stats }
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

/** Claude Code's login: the OAuth token and the plan it's on. */
async function credentials(): Promise<{ token: string; plan?: string } | undefined> {
  const parse = (json?: string) => {
    try {
      const o = json ? JSON.parse(json).claudeAiOauth : undefined
      return o?.accessToken ? { token: o.accessToken as string, plan: o.subscriptionType as string | undefined } : undefined
    } catch {
      return undefined
    }
  }
  if (process.platform === 'darwin') {
    const found = parse(await run('/usr/bin/security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w']))
    if (found) return found
  }
  try {
    return parse(fs.readFileSync(path.join(claudeDir(), '.credentials.json'), 'utf8'))
  } catch {
    return undefined
  }
}

/** The usage endpoint asked us to slow down. */
export class RateLimited extends Error {
  constructor(readonly waitMs: number) {
    super('rate limited')
  }
}

export async function usage(): Promise<ProviderUsage | null> {
  const creds = await credentials()
  if (!creds) return null
  try {
    const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: { Authorization: `Bearer ${creds.token}`, 'anthropic-beta': 'oauth-2025-04-20' },
      signal: AbortSignal.timeout(15_000),
    })
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after')) || 300
      throw new RateLimited(wait * 1000)
    }
    if (!res.ok) return null
    const limits = parseUsage(await res.json())
    if (!limits.length) return null
    const plan = creds.plan ? creds.plan[0].toUpperCase() + creds.plan.slice(1) : undefined
    return { id: 'claude', name: 'Claude', plan, limits, asOf: Date.now(), live: true }
  } catch (e) {
    if (e instanceof RateLimited) throw e
    return null
  }
}

export function parseUsage(obj: any): UsageLimit[] {
  const time = (v: unknown) => (typeof v === 'string' ? Date.parse(v) || undefined : undefined)
  const out: UsageLimit[] = []
  const has = (label: string) => out.some((l) => l.label === label)
  // The limits list, all of it: is_active only marks the limit that binds right now, while Claude Code's
  // /usage shows every one.
  for (const l of Array.isArray(obj?.limits) ? obj.limits : []) {
    const model = l.scope?.model?.display_name as string | undefined
    const weekly = l.group === 'weekly' || String(l.kind ?? '').startsWith('weekly')
    const label = l.kind === 'session' ? '5-hour' : weekly ? (model ? `Weekly · ${model}` : 'Weekly') : String(l.kind ?? 'Limit')
    if (has(label)) continue
    out.push({ label, percent: Number(l.percent ?? 0), resetsAt: time(l.resets_at), windowMinutes: l.kind === 'session' ? 300 : weekly ? 10080 : undefined })
  }
  // The older per-bucket fields fill in whatever the list leaves out.
  const buckets = [['five_hour', '5-hour', 300], ['seven_day', 'Weekly', 10080], ['seven_day_opus', 'Weekly · Opus', 10080], ['seven_day_sonnet', 'Weekly · Sonnet', 10080]] as const
  for (const [key, label, windowMinutes] of buckets) {
    const b = obj?.[key]
    if (b && typeof b.utilization === 'number' && !has(label)) out.push({ label, percent: b.utilization, resetsAt: time(b.resets_at), windowMinutes })
  }
  // 5-hour first, then the all-models week, then per-model weeks.
  const rank = (l: UsageLimit) => (l.label === '5-hour' ? 0 : l.label === 'Weekly' ? 1 : 2)
  return out.sort((x, y) => rank(x) - rank(y))
}
