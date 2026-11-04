import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {}, net: {} }))
const { assetFor, newer, swapScript } = await import('../src/main/updates')

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

describe('swapScript', () => {
  const unix = process.platform !== 'win32'
  const setup = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tezgah-swap-'))
    return { dir, target: path.join(dir, 'Tezgah.app'), download: path.join(dir, 'download', 'Tezgah.app') }
  }
  const swap = (platform: string, target: string, download: string) =>
    execFileSync('/bin/sh', ['-c', swapScript(platform), 'sh', target, download], { stdio: 'pipe' })
  const leftovers = (dir: string) => fs.readdirSync(dir).filter((f) => /\.(old|new)$/.test(f))

  it.runIf(process.platform === 'darwin')('macOS: replaces the app, and keeps it when the copy fails', () => {
    const { dir, target, download } = setup()
    fs.mkdirSync(path.join(target, 'Contents'), { recursive: true })
    fs.writeFileSync(path.join(target, 'Contents', 'version'), 'old')
    swap('darwin', target, download) // nothing downloaded: ditto fails
    expect(fs.readFileSync(path.join(target, 'Contents', 'version'), 'utf8')).toBe('old')
    expect(leftovers(dir)).toEqual([])
    fs.mkdirSync(path.join(download, 'Contents'), { recursive: true })
    fs.writeFileSync(path.join(download, 'Contents', 'version'), 'new')
    swap('darwin', target, download)
    expect(fs.readFileSync(path.join(target, 'Contents', 'version'), 'utf8')).toBe('new')
    expect(fs.existsSync(path.join(target, 'Contents', 'Contents'))).toBe(false)
    expect(leftovers(dir)).toEqual([])
  })

  it.runIf(process.platform === 'darwin')('macOS: puts back an app an interrupted swap left as .old', () => {
    const { dir, target, download } = setup()
    fs.mkdirSync(`${target}.old`)
    swap('darwin', target, download)
    expect(fs.statSync(target).isDirectory()).toBe(true)
    expect(leftovers(dir)).toEqual([])
  })

  it.runIf(unix)('Linux: replaces the AppImage through a copy beside it', () => {
    const { dir, target, download } = setup()
    fs.writeFileSync(target, 'old')
    swap('linux', target, download) // nothing downloaded
    expect(fs.readFileSync(target, 'utf8')).toBe('old')
    fs.mkdirSync(path.dirname(download))
    fs.writeFileSync(download, 'new')
    swap('linux', target, download)
    expect(fs.readFileSync(target, 'utf8')).toBe('new')
    expect(fs.statSync(target).mode & 0o111).not.toBe(0)
    expect(leftovers(dir)).toEqual([])
  })
})
