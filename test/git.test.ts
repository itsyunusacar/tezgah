import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { diff, parseNameStatus, parseNumstat, patchPath, unquote } from '../src/main/git'

describe('git -z output', () => {
  it('reads name-status with renames and non-ASCII paths', () => {
    const files = parseNameStatus('M\0çalışma.md\0R087\0src/a/f.ts\0src/b/f.ts\0A\0yeni dosya.txt\0D\0old\0C100\0x\0y\0T\0link\0')
    expect([...files]).toEqual([
      ['çalışma.md', 'M'],
      ['src/b/f.ts', 'R'],
      ['yeni dosya.txt', 'A'],
      ['old', 'D'],
      ['y', 'A'],
      ['link', 'M'],
    ])
  })

  it('reads numstat with renames and binary files', () => {
    const stats = parseNumstat('3\t1\tçalışma.md\x002\t0\t\0src/a/f.ts\0src/b/f.ts\0-\t-\timg.png\0')
    expect(stats.get('çalışma.md')).toEqual({ added: 3, removed: 1 })
    expect(stats.get('src/b/f.ts')).toEqual({ added: 2, removed: 0 })
    expect(stats.get('img.png')).toEqual({ added: 0, removed: 0 })
    expect(stats.size).toBe(3)
  })
})

describe('diff headers', () => {
  it('unquotes C-style paths', () => {
    expect(unquote('"a/\\303\\247al\\304\\261\\305\\237ma.md"')).toBe('a/çalışma.md')
    expect(unquote('"b/tab\\there \\"q\\""')).toBe('b/tab\there "q"')
    expect(unquote('plain')).toBe('plain')
  })

  it('finds the path of a chunk', () => {
    expect(patchPath('diff --git a/çalışma.md b/çalışma.md\nindex 1..2\n')).toBe('çalışma.md')
    expect(patchPath('diff --git a/with b/space.txt b/with b/space.txt\n')).toBe('with b/space.txt')
    expect(patchPath('diff --git "a/\\303\\247.md" "b/\\303\\247.md"\n')).toBe('ç.md')
    expect(patchPath('diff --git a/src/a/f.ts b/src/b/f.ts\nsimilarity index 90%\nrename from src/a/f.ts\nrename to src/b/f.ts\n')).toBe('src/b/f.ts')
  })
})

describe('diff of a repo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tezgah-git-'))
  const run = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir })
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('lists non-ASCII, renamed and untracked files with their patches', async () => {
    run('init', '-q')
    fs.mkdirSync(path.join(dir, 'src/a'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'çalışma.md'), 'bir\n')
    fs.writeFileSync(path.join(dir, 'src/a/f.ts'), Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n') + '\n')
    run('add', '-A')
    run('commit', '-qm', 'init')

    fs.writeFileSync(path.join(dir, 'çalışma.md'), 'bir\niki\n')
    fs.mkdirSync(path.join(dir, 'src/b'))
    run('mv', 'src/a/f.ts', 'src/b/f.ts')
    fs.appendFileSync(path.join(dir, 'src/b/f.ts'), 'added\n')
    run('add', '-A')
    fs.writeFileSync(path.join(dir, 'yeni dosya ğ.txt'), 'a\nb\nc\n')
    fs.writeFileSync(path.join(dir, 'bin.dat'), Buffer.from([1, 0, 2]))

    const d = (await diff(dir))!
    const by = Object.fromEntries(d.files.map((f) => [f.path, f]))
    expect(by['çalışma.md']).toMatchObject({ status: 'M', added: 1, removed: 0 })
    expect(by['src/b/f.ts']).toMatchObject({ status: 'R', added: 1, removed: 0 })
    expect(by['yeni dosya ğ.txt']).toMatchObject({ status: 'U', added: 3 })
    expect(by['bin.dat']).toMatchObject({ status: 'U', added: 0 })
    expect(d.patches['çalışma.md']).toContain('+iki')
    expect(d.patches['src/b/f.ts']).toContain('+added')
    expect(d.patches['yeni dosya ğ.txt']).toContain('+c')

    // Read again from the cache, then again once the file changes.
    fs.appendFileSync(path.join(dir, 'yeni dosya ğ.txt'), 'd\n')
    const again = (await diff(dir))!
    expect(again.files.find((f) => f.path === 'yeni dosya ğ.txt')?.added).toBe(4)
  })
})
