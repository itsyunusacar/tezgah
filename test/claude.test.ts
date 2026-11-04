import { describe, expect, it } from 'vitest'
import { keychainService, parseCredentials, parseTranscript, parseUsage, tallyLines, toolSummary } from '../src/main/claude'

describe('login', () => {
  it('names the Keychain item like Claude Code does', () => {
    expect(keychainService({})).toBe('Claude Code-credentials')
    expect(keychainService({ CLAUDE_CONFIG_DIR: '/tmp/cc' })).toBe('Claude Code-credentials-aa3d8c96')
    expect(keychainService({ CLAUDE_CONFIG_DIR: '/x', CLAUDE_SECURESTORAGE_CONFIG_DIR: '/tmp/cc' })).toBe('Claude Code-credentials-aa3d8c96')
    expect(keychainService({ CLAUDE_CONFIG_DIR: '/x', CLAUDE_SECURESTORAGE_CONFIG_DIR: '' })).toBe('Claude Code-credentials')
  })

  it('reads the token, plan and expiry', () => {
    expect(parseCredentials(JSON.stringify({ claudeAiOauth: { accessToken: 't', subscriptionType: 'max', expiresAt: 5 } }))).toEqual({ token: 't', plan: 'max', expiresAt: 5 })
    expect(parseCredentials('{}')).toBeUndefined()
    expect(parseCredentials('nope')).toBeUndefined()
  })
})

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

  it('reads the same meters whatever order the list comes in', () => {
    const list = [
      { kind: 'weekly_scoped', group: 'weekly', percent: 9, scope: { model: { display_name: 'Opus' } } },
      { kind: 'weekly_all', group: 'weekly', percent: 21 },
      { kind: 'weekly_oauth_apps', group: 'weekly', percent: 4 },
      { kind: 'weekly_scoped', group: 'weekly', percent: 30, scope: { model: { display_name: 'Fable' } } },
    ]
    const read = (l: object[]) => parseUsage({ limits: l }).map((x) => `${x.label} ${x.percent}`)
    expect(read(list)).toEqual(['Weekly 21', 'Weekly · Fable 30', 'Weekly · Opus 9'])
    expect(read([...list].reverse())).toEqual(read(list))
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

describe('conversation stats', () => {
  it('counts each message once and tracks the latest context', () => {
    const msg = (id: string, input: number, read: number, out: number) =>
      JSON.stringify({ type: 'assistant', message: { id, model: 'claude-opus-5-5', usage: { input_tokens: input, cache_creation_input_tokens: 0, cache_read_input_tokens: read, output_tokens: out } } })
    const stats = tallyLines([msg('a', 10, 1000, 50), msg('a', 10, 1000, 50), msg('b', 5, 2000, 20), '{"type":"user"}'], new Set(), { input: 0, output: 0, cacheRead: 0, context: 0, messages: 0 })
    expect(stats).toEqual({ input: 3015, output: 70, cacheRead: 3000, context: 2025, messages: 2, model: 'claude-opus-5-5' })
  })
})
