import { describe, expect, it } from 'vitest'
import { normalizeUrl, shellPath } from '../src/renderer/src/paths'
import { browsable } from '../src/shared/open'

describe('shellPath', () => {
  it('escapes spaces and shell characters on macOS/Linux', () => {
    expect(shellPath('/Users/me/Desktop/Screenshot 2026-10-28 at 11.02.png', false)).toBe('/Users/me/Desktop/Screenshot\\ 2026-10-28\\ at\\ 11.02.png')
    expect(shellPath("/tmp/it's (1).png", false)).toBe("/tmp/it\\'s\\ \\(1\\).png")
    expect(shellPath('/Users/me/Masaüstü/görsel.png', false)).toBe('/Users/me/Masa\\üst\\ü/g\\örsel.png')
  })

  it('leaves plain paths alone', () => {
    expect(shellPath('/repo/src/app.tsx', false)).toBe('/repo/src/app.tsx')
  })

  it('quotes on Windows only when needed', () => {
    expect(shellPath('C:\\Users\\me\\My Pictures\\a.png', true)).toBe('"C:\\Users\\me\\My Pictures\\a.png"')
    expect(shellPath('C:\\a.png', true)).toBe('C:\\a.png')
  })
})

describe('normalizeUrl', () => {
  it('keeps full URLs', () => {
    expect(normalizeUrl('https://example.com/a')).toBe('https://example.com/a')
    expect(normalizeUrl('file:///tmp/a.html')).toBe('file:///tmp/a.html')
  })
  it('uses http for local servers and https for domains', () => {
    expect(normalizeUrl('localhost:5173')).toBe('http://localhost:5173')
    expect(normalizeUrl('127.0.0.1:8000/docs')).toBe('http://127.0.0.1:8000/docs')
    expect(normalizeUrl('github.com/itsyunusacar')).toBe('https://github.com/itsyunusacar')
  })
  it('searches anything else', () => {
    expect(normalizeUrl('react useEffect')).toBe('https://www.google.com/search?q=react%20useEffect')
  })
  it('opens no other schemes', () => {
    expect(normalizeUrl('about:blank')).toBe('about:blank')
    expect(normalizeUrl('data:text/html,hi')).toBe('data:text/html,hi')
    expect(normalizeUrl('zoommtg://zoom.us/join')).toBe('https://www.google.com/search?q=zoommtg%3A%2F%2Fzoom.us%2Fjoin')
    expect(normalizeUrl('chrome://gpu')).toMatch(/^https:\/\/www\.google\.com\/search/)
    expect(normalizeUrl('javascript:alert(1)')).toMatch(/^https:\/\/www\.google\.com\/search/)
    expect(normalizeUrl('about:config')).toMatch(/^https:\/\/www\.google\.com\/search/)
  })
})

describe('browsable', () => {
  it('allows the web, files, data: and the blank page', () => {
    for (const url of ['http://localhost:3000', 'https://example.com', 'file:///tmp/a.html', 'data:text/html,x', 'about:blank']) expect(browsable(url)).toBe(true)
    for (const url of ['ssh://host', 'chrome://settings', 'devtools://devtools', 'view-source:https://a.com', 'javascript:1', 'x://y', 'about:gpu', 'nonsense']) expect(browsable(url)).toBe(false)
  })
})
