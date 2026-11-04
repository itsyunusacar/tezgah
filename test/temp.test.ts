import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ownFolder, privateTempFile, writePrivate } from '../src/main/temp'

const unix = process.platform !== 'win32'
let tmp: string
const saved = process.env.TMPDIR

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tezgah-temp-')))
  process.env.TMPDIR = tmp
})
afterEach(() => {
  // Assigning undefined would leave the string "undefined" (Linux CI has no TMPDIR).
  if (saved === undefined) delete process.env.TMPDIR
  else process.env.TMPDIR = saved
})

describe.runIf(unix)('privateTempFile', () => {
  it("puts files in this user's own folder, readable only by them", () => {
    const file = privateTempFile('tezgah-images', 'a.png')
    expect(path.dirname(file)).toBe(path.join(tmp, `tezgah-images-${process.getuid!()}`))
    expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700)
    writePrivate(file, Buffer.from('png'))
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
  })

  it('removes files older than a day', () => {
    const old = privateTempFile('tezgah-shots', 'old.png')
    writePrivate(old, Buffer.from('x'))
    const day = (Date.now() - 25 * 3_600_000) / 1000
    fs.utimesSync(old, day, day)
    const recent = privateTempFile('tezgah-shots', 'recent.png')
    writePrivate(recent, Buffer.from('x'))
    privateTempFile('tezgah-shots', 'next.png')
    expect(fs.existsSync(old)).toBe(false)
    expect(fs.existsSync(recent)).toBe(true)
  })

  it("won't use a folder others can get into", () => {
    const dir = path.join(tmp, `tezgah-shots-${process.getuid!()}`)
    fs.mkdirSync(dir, { mode: 0o777 })
    fs.chmodSync(dir, 0o777)
    expect(ownFolder(dir)).toBe(false)
    expect(() => privateTempFile('tezgah-shots', 'a.png')).toThrow(/belongs to someone else/)
  })
})
