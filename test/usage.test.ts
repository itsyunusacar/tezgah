import { describe, expect, it } from 'vitest'
import { codexReport, windowLabel } from '../src/main/usage'

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
})
