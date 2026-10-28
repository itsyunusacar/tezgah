import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import type { ProviderUsage, UsageLimit } from '../shared/types'
import * as claude from './claude'

// Plan limits of the agents you use, for the bottom of the sidebar. Claude's come live from the
// endpoint Claude Code's /usage uses; Codex's from the last report in its own session logs.

let claudeCache: { at: number; value: ProviderUsage | null } | undefined

async function claudeUsage(): Promise<ProviderUsage | null> {
  if (claudeCache && Date.now() - claudeCache.at < 170_000) return claudeCache.value
  const value = await claude.usage()
  claudeCache = { at: Date.now(), value: value ?? claudeCache?.value ?? null }
  return claudeCache.value
}

/** "5-hour", "Weekly"… from a window length. */
export function windowLabel(minutes?: number): string {
  if (!minutes) return 'Limit'
  if (minutes === 300) return '5-hour'
  if (minutes === 10080) return 'Weekly'
  if (minutes >= 40000 && minutes <= 45000) return 'Monthly'
  if (minutes % 1440 === 0) return `${minutes / 1440}-day`
  if (minutes % 60 === 0) return `${minutes / 60}-hour`
  return `${minutes}-min`
}

interface CodexWindow {
  used_percent?: number
  window_minutes?: number
  resets_at?: number
  resets_in_seconds?: number
}

/** The newest rate-limit report in a Codex session log (JSON lines), or undefined. */
export function codexReport(lines: string[], now = Date.now()): Omit<ProviderUsage, 'id' | 'name'> | undefined {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"rate_limits"')) continue
    let obj
    try {
      obj = JSON.parse(lines[i])
    } catch {
      continue
    }
    const rl = obj.payload?.rate_limits ?? obj.rate_limits
    if (!rl) continue
    const asOf = (obj.timestamp && Date.parse(obj.timestamp)) || Date.now()
    const limits: UsageLimit[] = []
    for (const w of [rl.primary, rl.secondary] as (CodexWindow | null | undefined)[]) {
      if (!w || typeof w.used_percent !== 'number') continue
      let resetsAt = w.resets_at ? w.resets_at * 1000 : w.resets_in_seconds !== undefined ? asOf + w.resets_in_seconds * 1000 : undefined
      let percent = w.used_percent
      // The window has rolled over since Codex last reported: it starts again from zero.
      if (resetsAt && resetsAt < now) {
        percent = 0
        resetsAt = undefined
      }
      limits.push({ label: windowLabel(w.window_minutes), percent, resetsAt, windowMinutes: w.window_minutes })
    }
    if (!limits.length) continue
    const plan = typeof rl.plan_type === 'string' ? rl.plan_type : undefined
    return { plan: plan ? plan[0].toUpperCase() + plan.slice(1) : undefined, limits, asOf, live: false }
  }
  return undefined
}

function codexHome(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex')
}

/** Session logs, newest first: sessions/YYYY/MM/DD/rollout-*.jsonl(.zst). */
function codexLogs(limit: number): string[] {
  const root = path.join(codexHome(), 'sessions')
  const desc = (dir: string) => {
    try {
      return fs.readdirSync(dir).sort().reverse()
    } catch {
      return []
    }
  }
  const out: string[] = []
  for (const y of desc(root))
    for (const m of desc(path.join(root, y)))
      for (const d of desc(path.join(root, y, m))) {
        const dir = path.join(root, y, m, d)
        const files = desc(dir)
          .filter((f) => /\.jsonl(\.zst)?$/.test(f))
          .map((f) => ({ f: path.join(dir, f), t: fs.statSync(path.join(dir, f)).mtimeMs }))
          .sort((a, b) => b.t - a.t)
        for (const { f } of files) {
          out.push(f)
          if (out.length >= limit) return out
        }
      }
  return out
}

const codexCache = new Map<string, { mtime: number; report: ReturnType<typeof codexReport> }>()

function codexUsage(): ProviderUsage | null {
  for (const file of codexLogs(5)) {
    try {
      const mtime = fs.statSync(file).mtimeMs
      let hit = codexCache.get(file)
      if (!hit || hit.mtime !== mtime) {
        const raw = fs.readFileSync(file)
        const text = (file.endsWith('.zst') ? zlib.zstdDecompressSync(raw) : raw).toString('utf8')
        // Cached as reported (now = 0 rolls nothing over); windows that reset since are applied below.
        hit = { mtime, report: codexReport(text.split('\n'), 0) }
        codexCache.set(file, hit)
      }
      if (hit.report) {
        const now = Date.now()
        const limits = hit.report.limits.map((l) => (l.resetsAt && l.resetsAt < now ? { ...l, percent: 0, resetsAt: undefined } : l))
        return { id: 'codex', name: 'Codex', ...hit.report, limits }
      }
    } catch {
      // Being written, or a format we can't read.
    }
  }
  return null
}

export async function allUsage(): Promise<ProviderUsage[]> {
  const [c, x] = await Promise.all([claudeUsage(), Promise.resolve().then(codexUsage)])
  return [c, x].filter((p): p is ProviderUsage => !!p)
}
