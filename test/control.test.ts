import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {}, ipcMain: {} }))
const { linuxSocket } = await import('../src/main/control')

describe('linuxSocket', () => {
  const base = { userData: '/home/me/.config/Tezgah', tmp: '/tmp', uid: 1000 }

  it("uses the user's runtime folder", () => {
    expect(linuxSocket('abc', { ...base, runtimeDir: '/run/user/1000' })).toBe('/run/user/1000/tezgah-abc.sock')
  })

  it('falls back to the profile folder, never straight into /tmp', () => {
    expect(linuxSocket('abc', base)).toBe('/home/me/.config/Tezgah/tezgah-abc.sock')
    expect(linuxSocket('abc', { ...base, runtimeDir: 'relative' })).toBe('/home/me/.config/Tezgah/tezgah-abc.sock')
  })

  it('keeps the path short enough for a socket', () => {
    const long = `/home/me/${'x'.repeat(100)}`
    expect(linuxSocket('abc', { ...base, userData: long })).toBe('/tmp/tezgah-1000/tezgah-abc.sock')
    expect(linuxSocket('abc', { ...base, userData: long, runtimeDir: long })).toBe('/tmp/tezgah-1000/tezgah-abc.sock')
  })
})
