import { describe, expect, it, vi } from 'vitest'

// activity.ts imports the app's modules; only its pure pieces are tested here.
vi.mock('../src/renderer/src/actions', () => ({}))
vi.mock('../src/renderer/src/store', () => ({ store: () => ({}) }))
vi.mock('../src/renderer/src/terminals', () => ({}))
const { decide, agentName } = await import('../src/renderer/src/activity')

describe('activity status', () => {
  it('sees a question on screen as needing you', () => {
    expect(decide('Run `rm -rf build`?\n  1. Yes, allow once\n  2. No')).toBe('blocked')
    expect(decide('Apply these changes? (y/n)')).toBe('blocked')
    expect(decide('Do you want to proceed?')).toBe('blocked')
  })

  it('ignores an answered question further up', () => {
    expect(decide('Apply these changes? (y/n) y\n⠙ writing\nDone: updated 2 files.\n> ')).toBe('done')
  })

  it('anything else as done', () => {
    expect(decide('Updated src/app.ts and ran the tests: 12 passed.\n> ')).toBe('done')
  })

  it('names agents', () => {
    expect(agentName('grok')).toBe('Grok')
    expect(agentName('cursor-agent')).toBe('Cursor')
    expect(agentName('newagent')).toBe('Newagent')
  })
})
