import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isLocalOrigin, localFileAllowed, permitted } from '../src/main/browser-policy'

describe('permitted', () => {
  it('gives any page only harmless permissions', () => {
    expect(permitted('fullscreen', 'https://example.com')).toBe(true)
    expect(permitted('clipboard-sanitized-write', 'https://example.com')).toBe(true)
    for (const p of ['media', 'geolocation', 'notifications', 'clipboard-read', 'midi', 'openExternal', 'display-capture'])
      expect(permitted(p, 'https://example.com')).toBe(false)
  })

  it('lets a local dev server use the camera, location, notifications, clipboard and MIDI', () => {
    for (const origin of ['http://localhost:5173', 'https://localhost', 'http://127.0.0.1:8000', 'http://[::1]:3000'])
      for (const p of ['media', 'geolocation', 'notifications', 'clipboard-read', 'midi', 'fullscreen']) expect(permitted(p, origin)).toBe(true)
  })

  it('never allows screen capture, other apps or MIDI system exclusive', () => {
    for (const p of ['display-capture', 'openExternal', 'midiSysex', 'usb', 'hid', 'serial']) expect(permitted(p, 'http://localhost:3000')).toBe(false)
  })
})

describe('isLocalOrigin', () => {
  it('knows localhost from look-alikes', () => {
    expect(isLocalOrigin('http://localhost:3000')).toBe(true)
    for (const o of ['http://localhost.evil.com', 'http://127.0.0.2', 'file:///tmp/a.html', 'ws://localhost', 'http://evil.com/localhost', '', 'null'])
      expect(isLocalOrigin(o)).toBe(false)
  })
})

describe('localFileAllowed', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tezgah-policy-')))
  const site = path.join(root, 'site')
  fs.mkdirSync(path.join(site, 'img'), { recursive: true })
  fs.writeFileSync(path.join(root, 'secret.txt'), 'x')
  const page = pathToFileURL(path.join(site, 'index.html')).href
  const url = (p: string) => pathToFileURL(p).href

  it("loads the page's own folder and below", () => {
    expect(localFileAllowed(page, url(path.join(site, 'style.css')))).toBe(true)
    expect(localFileAllowed(page, url(path.join(site, 'img', 'a b.png')))).toBe(true)
  })

  it('blocks everything outside it, however the path is spelled', () => {
    expect(localFileAllowed(page, url(path.join(root, 'secret.txt')))).toBe(false)
    expect(localFileAllowed(page, url(path.join(os.homedir(), '.aws', 'credentials')))).toBe(false)
    expect(localFileAllowed(page, `${url(site)}/../secret.txt`)).toBe(false)
    expect(localFileAllowed(page, `${url(site)}/%2e%2e/secret.txt`)).toBe(false)
    expect(localFileAllowed(page, `${url(site)}/img/..%2f..%2fsecret.txt`)).toBe(false)
    expect(localFileAllowed(page, url(`${site}-other/x.css`))).toBe(false)
    expect(localFileAllowed(page, 'file://otherhost/share/x.css')).toBe(false)
  })

  // Symlinks need administrator rights on Windows.
  it.skipIf(process.platform === 'win32')("doesn't follow a link out of the folder", () => {
    fs.symlinkSync(path.join(root, 'secret.txt'), path.join(site, 'link.txt'))
    expect(localFileAllowed(page, url(path.join(site, 'link.txt')))).toBe(false)
  })

  it('gives web pages no local files', () => {
    expect(localFileAllowed('https://example.com/', url(path.join(site, 'style.css')))).toBe(false)
    expect(localFileAllowed('', url(path.join(site, 'style.css')))).toBe(false)
  })
})
