import { describe, expect, it } from 'vitest'
import { shellPath } from '../src/renderer/src/paths'

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
