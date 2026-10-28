import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {}, net: {} }))
const { assetFor, newer } = await import('../src/main/updates')

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

describe('assetFor', () => {
  // The files of the 1.0.2 release.
  const assets = [
    'Tezgah-1.0.2-amd64.deb', 'Tezgah-1.0.2-arm64-mac.zip', 'Tezgah-1.0.2-arm64.AppImage', 'Tezgah-1.0.2-arm64.deb',
    'Tezgah-1.0.2-arm64.dmg', 'Tezgah-1.0.2-mac.zip', 'Tezgah-1.0.2-x64.dmg', 'Tezgah-1.0.2-x86_64.AppImage',
    'Tezgah-Setup-1.0.2-arm64.exe', 'Tezgah-Setup-1.0.2-x64.exe', 'Tezgah-Setup-1.0.2.exe',
  ].map((name) => ({ name, browser_download_url: `https://github.com/x/${name}`, size: 1 }))
  const pick = (platform: string, arch: string, appImage = false) => assetFor(assets, '1.0.2', platform, arch, appImage)?.name

  it('finds the file each copy updates itself from', () => {
    expect(pick('darwin', 'arm64')).toBe('Tezgah-1.0.2-arm64-mac.zip')
    expect(pick('darwin', 'x64')).toBe('Tezgah-1.0.2-mac.zip')
    expect(pick('win32', 'x64')).toBe('Tezgah-Setup-1.0.2-x64.exe')
    expect(pick('win32', 'arm64')).toBe('Tezgah-Setup-1.0.2-arm64.exe')
    expect(pick('linux', 'x64', true)).toBe('Tezgah-1.0.2-x86_64.AppImage')
    expect(pick('linux', 'arm64', true)).toBe('Tezgah-1.0.2-arm64.AppImage')
  })

  it("leaves a .deb install to its package manager", () => {
    expect(pick('linux', 'x64')).toBeUndefined()
  })
})
