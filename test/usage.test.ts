import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { codexReport, codexUsage, logReports, steady, windowLabel } from '../src/main/usage'
import type { ProviderUsage, UsageLimit } from '../src/shared/types'

const line = (rate_limits: object, timestamp = '2026-10-18T20:42:48Z') =>
  JSON.stringify({ timestamp, type: 'event_msg', payload: { type: 'token_count', rate_limits } })

describe('Codex usage', () => {
  const now = Date.parse('2026-10-28T09:00:00Z')

  it('reads the newest report: windows, percent, reset time, plan', () => {
    const r = codexReport([
      line({ primary: { used_percent: 50, window_minutes: 300, resets_at: 1 } }),
      'not json',
      line({ primary: { used_percent: 12, window_minutes: 300, resets_at: now / 1000 + 3600 }, secondary: { used_percent: 40, window_minutes: 10080, resets_at: now / 1000 + 86400 }, plan_type: 'plus' }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message' } }),
    ], now)!
    expect(r.plan).toBe('Plus')
    expect(r.live).toBe(false)
    expect(r.limits.map((l) => `${l.label} ${l.percent}`)).toEqual(['5-hour 12', 'Weekly 40'])
    expect(r.limits[0].resetsAt).toBe(now + 3600_000)
    expect(r.asOf).toBe(Date.parse('2026-10-18T20:42:48Z'))
  })

  it('treats a window that has reset since as empty', () => {
    const r = codexReport([line({ primary: { used_percent: 80, window_minutes: 300, resets_at: now / 1000 - 60 } })], now)!
    expect(r.limits[0]).toMatchObject({ percent: 0, resetsAt: undefined })
  })

  it('supports the older resets_in_seconds form', () => {
    const r = codexReport([line({ primary: { used_percent: 5, window_minutes: 43200, resets_in_seconds: 60 } }, '2026-10-28T08:59:30Z')], now)!
    expect(r.limits[0]).toMatchObject({ label: 'Monthly', resetsAt: Date.parse('2026-10-28T09:00:30Z') })
  })

  it('names windows', () => {
    expect([300, 10080, 43200, 1440, 120, 45].map(windowLabel)).toEqual(['5-hour', 'Weekly', 'Monthly', '1-day', '2-hour', '45-min'])
  })

  it('prefers the plan’s own limit over a model’s separate quota', () => {
    const spark = { limit_id: 'codex_bengalfox', primary: { used_percent: 90, window_minutes: 300 } }
    const main = { limit_id: 'codex', primary: { used_percent: 10, window_minutes: 300 } }
    expect(codexReport([line(main), line(spark)], now)!.limits[0].percent).toBe(10)
    expect(codexReport([line({ primary: { used_percent: 20, window_minutes: 300 } }), line(spark)], now)!.limits[0].percent).toBe(20)
    // Only another quota reported: that's what there is.
    expect(codexReport([line(spark)], now)!.limits[0].percent).toBe(90)
  })
})

describe('Codex logs', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tezgah-codex-'))
  const dir = path.join(home, 'sessions', '2026', '10', '28')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(home, 'auth.json'), '{}')
  const at = (minutes: number) => new Date(Date.parse('2026-10-28T09:00:00Z') + minutes * 60_000).toISOString()
  const report = (percent: number, minutes: number) => line({ primary: { used_percent: percent, window_minutes: 300 } }, at(minutes)) + '\n'
  const filler = JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: 'x'.repeat(1000) } }) + '\n'
  afterAll(() => fs.rmSync(home, { recursive: true, force: true }))

  it('reads a big log’s tail, then only what is added', async () => {
    const file = path.join(dir, 'rollout-a.jsonl')
    fs.writeFileSync(file, report(5, 0) + filler.repeat(600) + report(30, 1) + filler.repeat(600) + 'partial')
    expect((await logReports(file)).main?.limits[0].percent).toBe(30)
    fs.appendFileSync(file, ' line\n' + filler + report(45, 2))
    expect((await logReports(file)).main?.limits[0].percent).toBe(45)
    fs.appendFileSync(file, filler)
    expect((await logReports(file)).main?.limits[0].percent).toBe(45)
  })

  it('takes the newest report of all recent sessions, not the last written log', async () => {
    vi.stubEnv('CODEX_HOME', home)
    const b = path.join(dir, 'rollout-b.jsonl')
    fs.writeFileSync(b, report(80, -60) + filler)
    // b was written last, but a's report is newer.
    fs.utimesSync(b, new Date(), new Date(Date.now() + 1000))
    expect((await codexUsage())?.limits[0].percent).toBe(45)
    fs.writeFileSync(path.join(dir, 'gone.jsonl.zst'), 'not zstd')
    expect((await codexUsage())?.limits[0].percent).toBe(45)
    vi.unstubAllEnvs()
  })
})

describe('steady meters', () => {
  const now = Date.parse('2026-10-28T09:00:00Z')
  const hour = 3_600_000
  const usage = (...limits: UsageLimit[]): ProviderUsage => ({ id: 'claude', name: 'Claude', limits, asOf: now, live: true })
  const five = (percent: number, resetsAt?: number): UsageLimit => ({ label: '5-hour', percent, resetsAt, windowMinutes: 300 })
  const week = (percent: number, resetsAt?: number): UsageLimit => ({ label: 'Weekly', percent, resetsAt, windowMinutes: 10080 })

  it('never go back within a window, even when the reset time drifts a little', () => {
    const was = usage(five(34, now + 2 * hour), week(21, now + 50 * hour))
    const next = steady(was, usage(five(33, now + 2 * hour + 40_000), week(22, now + 50 * hour)), now)
    expect(next.limits.map((l) => l.percent)).toEqual([34, 22])
    expect(next.limits[0].resetsAt).toBe(now + 2 * hour + 40_000)
  })

  it('start over once the window has reset', () => {
    const was = usage(five(80, now - 60_000))
    expect(steady(was, usage(five(0)), now).limits[0].percent).toBe(0)
    expect(steady(usage(five(80, now + hour)), usage(five(5, now + 5 * hour)), now).limits[0].percent).toBe(5)
  })

  it('keep a limit an answer left out until its window resets, in its place', () => {
    const was = usage(five(10, now + hour), week(40, now + 50 * hour))
    expect(steady(was, usage(week(41, now + 50 * hour)), now).limits.map((l) => `${l.label} ${l.percent}`)).toEqual(['5-hour 10', 'Weekly 41'])
    expect(steady(usage(five(10, now - 1)), usage(week(41)), now).limits.map((l) => l.label)).toEqual(['Weekly'])
  })

  it('a missing reset time is the same window until the old one was due', () => {
    expect(steady(usage(five(50, now + hour)), usage(five(20)), now).limits[0].percent).toBe(50)
  })
})
