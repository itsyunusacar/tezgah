import { describe, expect, it } from 'vitest'
import { parseUsage, toolSummary } from '../src/main/claude'

describe('usage', () => {
  it('reads the limits list, skipping inactive ones', () => {
    const limits = parseUsage({
      limits: [
        { kind: 'session', percent: 34, resets_at: '2026-10-28T12:00:00Z' },
        { kind: 'weekly_all', percent: 21 },
        { kind: 'weekly_model', percent: 9, scope: { model: { display_name: 'Opus' } } },
        { kind: 'weekly_other', percent: 1, is_active: false },
      ],
    })
    expect(limits.map((l) => `${l.label} ${l.percent}`)).toEqual(['5h 34', 'Week 21', 'Week · Opus 9'])
    expect(limits[0].resetsAt).toBe(Date.parse('2026-10-28T12:00:00Z'))
  })

  it('falls back to the older five_hour / seven_day shape', () => {
    expect(parseUsage({ five_hour: { utilization: 50 }, seven_day: { utilization: 10 } }).map((l) => l.label)).toEqual(['5h', 'Week'])
  })
})

describe('tool summaries', () => {
  it('describes what a subagent is doing', () => {
    expect(toolSummary('Read', { file_path: '/repo/src/app.tsx' })).toBe('Read app.tsx')
    expect(toolSummary('Bash', { command: 'npm   test\n--watch' })).toBe('Bash npm test --watch')
    expect(toolSummary('Grep', { pattern: 'useTheme' })).toBe('Grep "useTheme"')
    expect(toolSummary('Task', {})).toBe('Task')
  })
})
