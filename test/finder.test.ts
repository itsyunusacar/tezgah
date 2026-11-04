import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { command, install, remove, serviceDir, statusKey, workflowFiles } from '../src/main/finder'

const mac = process.platform === 'darwin'
const unix = process.platform !== 'win32'
let home: string
let dir: string
const app = "/Applications/Tez gah's.app"

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'tezgah-finder-'))
  dir = serviceDir(home)
})

describe('Finder Quick Action', () => {
  it('goes in the Services folder it is given, never the real one in tests', () => {
    expect(dir).toBe(path.join(home, 'Library', 'Services', 'Open in Tezgah.workflow'))
  })

  it('writes a service for folders in Finder, titled in the app’s language', () => {
    expect(install(dir, 'Tezgah\'ta Aç', app, 'dev.tezgah.app')).toBe(true)
    const info = fs.readFileSync(path.join(dir, 'Contents/Info.plist'), 'utf8')
    expect(info).toContain('<string>runWorkflowAsService</string>')
    expect(info).toContain('<string>public.folder</string>')
    expect(info).toContain('<string>com.apple.finder</string>')
    expect(info).toContain("<string>Tezgah'ta Aç</string>")
    const doc = fs.readFileSync(path.join(dir, 'Contents/document.wflow'), 'utf8')
    expect(doc).toContain('com.apple.Automator.fileSystemObject.folder')
    expect(doc).toContain('com.apple.Automator.servicesMenu')
    expect(doc).toContain(command(app, 'dev.tezgah.app'))
  })

  it.runIf(mac)('is made of valid property lists', () => {
    install(dir, 'Open in Tezgah', app, 'dev.tezgah.app')
    for (const f of ['Contents/Info.plist', 'Contents/document.wflow']) execFileSync('plutil', ['-lint', path.join(dir, f)])
    const stored = execFileSync('plutil', ['-extract', 'actions.0.action.ActionParameters.COMMAND_STRING', 'raw', '-o', '-', path.join(dir, 'Contents/document.wflow')], { encoding: 'utf8' })
    expect(stored.trim()).toBe(command(app, 'dev.tezgah.app'))
  })

  it.runIf(unix)('opens every chosen folder with this copy of Tezgah, whatever their names', () => {
    // A stand-in for `open` that prints what it was given, one argument per line.
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'tezgah-bin-'))
    fs.writeFileSync(path.join(bin, 'open'), '#!/bin/sh\nfor a in "$@"; do echo "$a"; done\n', { mode: 0o755 })
    const folders = ['/Users/me/My Project', "/Users/me/it's $(here)"]
    const out = execFileSync('/bin/sh', ['-c', command(app, 'dev.tezgah.app'), 'sh', ...folders], { env: { PATH: `${bin}:/usr/bin:/bin` }, encoding: 'utf8' })
    expect(out.trim().split('\n')).toEqual(['-a', app, ...folders])
  })

  it('writes nothing when it is up to date, and follows the app when it moves', () => {
    install(dir, 'Open in Tezgah', app, 'dev.tezgah.app')
    expect(install(dir, 'Open in Tezgah', app, 'dev.tezgah.app')).toBe(false)
    expect(install(dir, 'Open in Tezgah', '/Users/me/Applications/Tezgah.app', 'dev.tezgah.app')).toBe(true)
    expect(fs.readFileSync(path.join(dir, 'Contents/document.wflow'), 'utf8')).toContain('/Users/me/Applications/Tezgah.app')
    expect(workflowFiles('Open in Tezgah', app, 'x')['Contents/document.wflow']).not.toContain('/Users/me/Applications')
  })

  it('goes away when turned off', () => {
    install(dir, 'Open in Tezgah', app, 'dev.tezgah.app')
    expect(remove(dir)).toBe(true)
    expect(fs.existsSync(dir)).toBe(false)
    expect(remove(dir)).toBe(false)
  })
})

describe('statusKey', () => {
  it('is the key macOS keeps the service on or off under, by its title', () => {
    expect(statusKey('Open in Tezgah')).toBe('(null) - Open in Tezgah - runWorkflowAsService')
    expect(statusKey("Tezgah'ta Aç")).toBe("(null) - Tezgah'ta Aç - runWorkflowAsService")
  })
})
