import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Each test is a new launch: a fresh module (its per-session state) and a fresh folder.
let P: typeof import('../src/main/persist')
let dir: string
const at = (name: string) => path.join(dir, name)
const json = (name: string) => JSON.parse(fs.readFileSync(at(name), 'utf8'))

beforeEach(async () => {
  vi.resetModules()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  P = await import('../src/main/persist')
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tezgah-persist-'))
})

describe('readJson / writeJson', () => {
  it('starts from the fallback and saves', () => {
    expect(P.readJson(dir, 'ws.json', { a: 1, b: 0 })).toEqual({ a: 1, b: 0 })
    expect(P.writeJson(dir, 'ws.json', { a: 2 })).toBe(true)
    expect(P.readJson(dir, 'ws.json', { a: 1, b: 0 })).toEqual({ a: 2, b: 0 })
    expect(fs.existsSync(at('ws.json.tmp'))).toBe(false)
  })

  it('keeps the start-of-session copy as the backup', () => {
    fs.writeFileSync(at('ws.json'), JSON.stringify({ v: 'launch' }))
    P.readJson(dir, 'ws.json', {})
    P.writeJson(dir, 'ws.json', { v: 'one' })
    P.writeJson(dir, 'ws.json', { v: 'two' })
    expect(json('ws.json')).toEqual({ v: 'two' })
    expect(json('ws.json.bak')).toEqual({ v: 'launch' })
  })

  it('falls back to the backup when the file is damaged, and keeps both', () => {
    fs.writeFileSync(at('ws.json'), '{"v": "half')
    fs.writeFileSync(at('ws.json.bak'), JSON.stringify({ v: 'backup' }))
    expect(P.readJson(dir, 'ws.json', {})).toEqual({ v: 'backup' })
    expect(fs.readFileSync(at('ws.json.damaged'), 'utf8')).toBe('{"v": "half')
    P.writeJson(dir, 'ws.json', { v: 'new' })
    expect(json('ws.json')).toEqual({ v: 'new' })
    expect(json('ws.json.bak')).toEqual({ v: 'backup' })
  })

  it("never saves over a file it couldn't read", () => {
    // A directory stands in for a file another program holds: there, but unreadable.
    fs.mkdirSync(at('ws.json'))
    expect(P.readJson(dir, 'ws.json', { sessions: [] })).toEqual({ sessions: [] })
    expect(P.writeJson(dir, 'ws.json', { sessions: [] })).toBe(false)
    expect(fs.statSync(at('ws.json')).isDirectory()).toBe(true)
  })

  it('uses the backup for a locked file, and saves once the file can be read again', () => {
    fs.mkdirSync(at('ws.json'))
    fs.writeFileSync(at('ws.json.bak'), JSON.stringify({ v: 'backup' }))
    expect(P.readJson(dir, 'ws.json', {})).toEqual({ v: 'backup' })
    expect(P.writeJson(dir, 'ws.json', { v: 'edited' })).toBe(false)
    fs.rmdirSync(at('ws.json'))
    fs.writeFileSync(at('ws.json'), JSON.stringify({ v: 'real' }))
    expect(P.writeJson(dir, 'ws.json', { v: 'edited' })).toBe(true)
    expect(json('ws.json')).toEqual({ v: 'edited' })
    expect(json('ws.json.bak')).toEqual({ v: 'real' })
  })

  it("doesn't throw when it can't write", () => {
    const file = at('blocker')
    fs.writeFileSync(file, '')
    expect(P.writeJson(path.join(file, 'sub'), 'ws.json', {})).toBe(false)
  })
})

describe('retrying', () => {
  it('tries again while a file is busy, and gives up on other errors', () => {
    let n = 0
    const busy = () => {
      if (++n < 3) throw Object.assign(new Error('busy'), { code: 'EBUSY' })
      return 'ok'
    }
    expect(P.retrying(busy)).toBe('ok')
    expect(n).toBe(3)
    expect(() => P.retrying(() => {
      throw Object.assign(new Error('gone'), { code: 'ENOENT' })
    })).toThrow('gone')
  })
})
