import { app } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import type { ProviderUsage, UsageLimit } from '../shared/types'
import * as claude from './claude'

// Plan limits of the agents you use, for the bottom of the sidebar. Claude's come live from the
// endpoint Claude Code's /usage uses; Codex's from the last report in its own session logs.

// Claude's numbers: fetched at most every few minutes, longer when the endpoint asks us to wait, and
// the last good answer kept on disk so a failed or throttled fetch (or a fresh launch) still shows something.
let claudeLast: ProviderUsage | null | undefined
let nextFetch = 0

// Not usage-cache.json: the first (Swift) Tezgah keeps its own file by that name in the same folder.
const cacheFile = () => path.join(app.getPath('userData'), 'claude-limits.json')

function readCache(): ProviderUsage | null {
  try {
    const p = JSON.parse(fs.readFileSync(cacheFile(), 'utf8')) as ProviderUsage
    return p?.id === 'claude' && Array.isArray(p.limits) ? { ...p, live: false } : null
  } catch {
    return null
  }
}

async function claudeUsage(): Promise<ProviderUsage | null> {
  if (claudeLast === undefined) claudeLast = readCache()
  if (Date.now() < nextFetch) return claudeLast
  nextFetch = Date.now() + 170_000
  try {
    const fresh = await claude.usage()
    if (fresh) {
      claudeLast = fresh
      try {
        fs.writeFileSync(cacheFile(), JSON.stringify(fresh))
      } catch (e) {
        console.error('claude limits cache:', e)
      }
    } else if (claudeLast) claudeLast = { ...claudeLast, live: false }
  } catch (e) {
    if (e instanceof claude.RateLimited) nextFetch = Date.now() + Math.max(e.waitMs, 170_000)
    if (claudeLast) claudeLast = { ...claudeLast, live: false }
  }
  // A limit whose reset time has passed since has started over.
  if (!claudeLast) return null
  const now = Date.now()
  return { ...claudeLast, limits: claudeLast.limits.map((l) => (l.resetsAt && l.resetsAt < now ? { ...l, percent: 0, resetsAt: undefined } : l)) }
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

type Report = Omit<ProviderUsage, 'id' | 'name'>

/** The newest rate-limit reports in Codex log lines: of the plan's own limit (no limit_id, or "codex"),
 *  and of any other (a model with its own quota). Mixing the two made the meters jump between them. */
export function codexReports(lines: string[], now = Date.now()): { main?: Report; other?: Report } {
  const out: { main?: Report; other?: Report } = {}
  for (let i = lines.length - 1; i >= 0 && !out.main; i--) {
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
    const report = { plan: plan ? plan[0].toUpperCase() + plan.slice(1) : undefined, limits, asOf, live: false }
    if (rl.limit_id == null || rl.limit_id === 'codex') out.main = report
    else out.other ??= report
  }
  return out
}

/** The newest rate-limit report in a Codex session log (JSON lines), or undefined. */
export function codexReport(lines: string[], now = Date.now()): Report | undefined {
  const r = codexReports(lines, now)
  return r.main ?? r.other
}

/** The newer of two reports. */
const newer = (a?: Report, b?: Report) => (!a ? b : !b ? a : b.asOf > a.asOf ? b : a)

const NL = 10
const CHUNK = 256 << 10

interface LogState {
  size: number
  mtime: number
  /** Where the lines not read yet start (after the last complete line). */
  offset: number
  main?: Report
  other?: Report
}

/** Reads a plain log from its end backwards, a chunk at a time, until it finds the plan's report. */
async function readTail(fh: fs.promises.FileHandle, size: number): Promise<LogState> {
  const state: LogState = { size, mtime: 0, offset: size, main: undefined, other: undefined }
  let end = size
  let carry = Buffer.alloc(0)
  // The last line may still be being written: it's read with the next change.
  const tail = Buffer.alloc(Math.min(size, CHUNK))
  await fh.read(tail, 0, tail.length, size - tail.length)
  const lastNl = tail.lastIndexOf(NL)
  if (lastNl < 0 && size > tail.length) return readWhole(fh, size)
  state.offset = size - tail.length + lastNl + 1
  end = state.offset
  while (end > 0 && !state.main) {
    const start = Math.max(0, end - CHUNK)
    const buf = Buffer.alloc(end - start)
    await fh.read(buf, 0, buf.length, start)
    const all = Buffer.concat([buf, carry])
    // The first line may be cut off: it goes with the chunk before.
    const cut = start > 0 ? all.indexOf(NL) + 1 : 0
    carry = all.subarray(0, cut)
    const r = codexReports(all.subarray(cut).toString('utf8').split('\n'), 0)
    state.main = r.main
    state.other ??= r.other
    end = start
  }
  return state
}

async function readWhole(fh: fs.promises.FileHandle, size: number): Promise<LogState> {
  const buf = Buffer.alloc(size)
  await fh.read(buf, 0, size, 0)
  const last = buf.lastIndexOf(NL) + 1
  return { size, mtime: 0, offset: last, ...codexReports(buf.subarray(0, last).toString('utf8').split('\n'), 0) }
}

const codexCache = new Map<string, LogState>()

/** The newest reports in a session log, reading only what changed: new lines of the active (plain) log;
 *  a compressed one again only when it changes. Cached as reported (now = 0 rolls nothing over). */
export async function logReports(file: string): Promise<LogState> {
  const st = await fs.promises.stat(file)
  const prev = codexCache.get(file)
  if (prev && prev.size === st.size && prev.mtime === st.mtimeMs) return prev
  let state: LogState
  if (file.endsWith('.zst')) {
    const text = (await zstd(await fs.promises.readFile(file))).toString('utf8')
    state = { size: st.size, mtime: 0, offset: st.size, ...codexReports(text.split('\n'), 0) }
  } else {
    const fh = await fs.promises.open(file, 'r')
    try {
      if (prev && st.size > prev.size && prev.offset <= st.size) {
        // Grown: only the new lines.
        const buf = Buffer.alloc(st.size - prev.offset)
        await fh.read(buf, 0, buf.length, prev.offset)
        const last = buf.lastIndexOf(NL) + 1
        const r = codexReports(buf.subarray(0, last).toString('utf8').split('\n'), 0)
        state = { ...prev, size: st.size, offset: prev.offset + last, main: r.main ?? prev.main, other: r.other ?? prev.other }
      } else state = await readTail(fh, st.size)
    } finally {
      await fh.close()
    }
  }
  state.mtime = st.mtimeMs
  codexCache.set(file, state)
  return state
}

const zstd = (buf: Buffer) =>
  new Promise<Buffer>((resolve, reject) => zlib.zstdDecompress(buf, (err, out) => (err ? reject(err) : resolve(out))))

function codexHome(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex')
}

/** Session logs, newest first: sessions/YYYY/MM/DD/rollout-*.jsonl(.zst). */
async function codexLogs(limit: number): Promise<string[]> {
  const root = path.join(codexHome(), 'sessions')
  const desc = (dir: string) => fs.promises.readdir(dir).then((l) => l.sort().reverse(), () => [] as string[])
  // A file rotated or removed between listing and stat is skipped.
  const mtime = (f: string) => fs.promises.stat(f).then((s) => s.mtimeMs, () => -1)
  const out: string[] = []
  for (const y of await desc(root))
    for (const m of await desc(path.join(root, y)))
      for (const d of await desc(path.join(root, y, m))) {
        const dir = path.join(root, y, m, d)
        const names = (await desc(dir)).filter((f) => /\.jsonl(\.zst)?$/.test(f)).map((f) => path.join(dir, f))
        const files = (await Promise.all(names.map(async (f) => ({ f, t: await mtime(f) })))).filter((x) => x.t >= 0).sort((a, b) => b.t - a.t)
        for (const { f } of files) {
          out.push(f)
          if (out.length >= limit) return out
        }
      }
  return out
}

/** Codex is signed in (its login file), or was used this past week. A cancelled plan or a signed-out
 *  Codex shouldn't keep showing old numbers. */
function codexActive(asOf: number): boolean {
  return fs.existsSync(path.join(codexHome(), 'auth.json')) || Date.now() - asOf < 7 * 86_400_000
}

/** The newest report across the latest session logs: with two Codex sessions open, the log written
 *  last isn't always the one that reported limits last, and taking it made the numbers go back and forth. */
export async function codexUsage(): Promise<ProviderUsage | null> {
  let main: Report | undefined
  let other: Report | undefined
  for (const file of await codexLogs(5)) {
    try {
      const r = await logReports(file)
      main = newer(main, r.main)
      other = newer(other, r.other)
    } catch {
      // Rotated away, or a format we can't read.
    }
  }
  const report = main ?? other
  if (!report || !codexActive(report.asOf)) return null
  // Windows that reset since the report start over.
  const now = Date.now()
  const limits = report.limits.map((l) => (l.resetsAt && l.resetsAt < now ? { ...l, percent: 0, resetsAt: undefined } : l))
  return { id: 'codex', name: 'Codex', ...report, limits }
}

/** Reset times this close apart are one window: the service's drifts by seconds, now and then minutes. */
const SAME_WINDOW = 15 * 60_000

function sameWindow(was: UsageLimit, now: UsageLimit, at: number): boolean {
  if (was.resetsAt && now.resetsAt) return Math.abs(was.resetsAt - now.resetsAt) < SAME_WINDOW
  // No reset time this time: still the old window until it was due to reset.
  return !!was.resetsAt && !now.resetsAt && was.resetsAt > at
}

/** Limits that only go up within their window. The service's answers wobble (a point lower, then back)
 *  and a limit can be left out of one answer, so the meters went back and forth with them. A limit
 *  is lower again, or gone, only once its window has reset. */
export function steady(prev: ProviderUsage | undefined, next: ProviderUsage, at = Date.now()): ProviderUsage {
  if (!prev) return next
  const limits = next.limits.map((l) => {
    const was = prev.limits.find((x) => x.label === l.label)
    return was && sameWindow(was, l, at) && was.percent > l.percent ? { ...l, percent: was.percent, resetsAt: l.resetsAt ?? was.resetsAt } : l
  })
  for (const was of prev.limits) if (was.resetsAt && was.resetsAt > at && !limits.some((l) => l.label === was.label)) limits.push(was)
  return { ...next, limits: claude.orderLimits(limits) }
}

/** What the sidebar last showed, per agent. */
const shown = new Map<string, ProviderUsage>()

/** Each agent's limits on their own: one that fails never blanks the other. */
export async function allUsage(): Promise<ProviderUsage[]> {
  const settled = await Promise.allSettled([claudeUsage(), codexUsage()])
  return settled.flatMap((s) => {
    if (s.status === 'rejected') console.error('usage:', s.reason)
    if (s.status !== 'fulfilled' || !s.value) return []
    const usage = steady(shown.get(s.value.id), s.value)
    shown.set(usage.id, usage)
    return [usage]
  })
}
