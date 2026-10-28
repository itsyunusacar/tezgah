import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {}, net: {} }))
const { newer } = await import('../src/main/updates')

describe('newer', () => {
  it('compares versions and prereleases', () => {
    expect(newer('v1.0.0-alpha.2', '1.0.0-alpha.1')).toBe(true)
    expect(newer('1.0.0-alpha.10', '1.0.0-alpha.9')).toBe(true)
    expect(newer('1.0.0', '1.0.0-beta.3')).toBe(true)
    expect(newer('1.0.0-beta.1', '1.0.0-alpha.5')).toBe(true)
    expect(newer('1.0.0-alpha.1', '1.0.0-alpha.1')).toBe(false)
    expect(newer('0.9.9', '1.0.0-alpha.1')).toBe(false)
    expect(newer('1.1.0', '1.0.9')).toBe(true)
  })
})
