import { describe, expect, it } from 'vitest'
import { parseTranscript, parseUsage, toolSummary } from '../src/main/claude'

describe('usage', () => {
  it('reads every limit, including ones not binding right now, in order', () => {
    const limits = parseUsage({
      five_hour: { utilization: 17, resets_at: '2026-10-28T12:10:00Z' },
      seven_day: null,
      limits: [
        { kind: 'weekly_scoped', group: 'weekly', percent: 34, scope: { model: { display_name: 'Fable' } }, is_active: true },
        { kind: 'session', group: 'session', percent: 17, resets_at: '2026-10-28T12:10:00Z', is_active: false },
        { kind: 'weekly_all', group: 'weekly', percent: 21, is_active: false },
      ],
    })
    expect(limits.map((l) => `${l.label} ${l.percent}`)).toEqual(['5-hour 17', 'Weekly 21', 'Weekly · Fable 34'])
    expect(limits[0]).toMatchObject({ resetsAt: Date.parse('2026-10-28T12:10:00Z'), windowMinutes: 300 })
  })

  it('fills in from the per-bucket fields', () => {
    expect(parseUsage({ five_hour: { utilization: 50 }, seven_day: { utilization: 10 }, seven_day_opus: { utilization: 3 } }).map((l) => l.label)).toEqual([
      '5-hour',
      'Weekly',
      'Weekly · Opus',
    ])
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

describe('parseTranscript', () => {
  it('reads the task, words, tool calls and results', () => {
    const lines = [
      JSON.stringify({ type: 'user', message: { content: 'Find the login bug' } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Looking.' }, { type: 'tool_use', name: 'Read', input: { file_path: '/a/login.ts' } }] } }),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'line1\nline2' }] } }),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: [{ type: 'text', text: 'boom' }] }] } }),
      'not json',
    ]
    expect(parseTranscript(lines).map((e) => [e.kind, e.text])).toEqual([
      ['prompt', 'Find the login bug'],
      ['text', 'Looking.'],
      ['tool', 'Read login.ts'],
      ['result', 'line1\nline2'],
      ['error', 'boom'],
    ])
  })
})
