import { describe, expect, it, vi } from 'vitest'
import { descendants, parseLsof, parseNetstat, parseProcessTree, parseSs } from '../src/main/meta'

describe('process tree', () => {
  it('finds every descendant', () => {
    const tree = parseProcessTree('  1     0\n 10     1\n 11    10\n 12    11\n 20     1\n')
    expect([...descendants(tree, 10)].sort()).toEqual([10, 11, 12])
  })
})

describe('listening ports', () => {
  it('reads lsof', () => {
    const ports = parseLsof('p501\nn*:5173\nn[::1]:5173\np777\nn127.0.0.1:3000\n')
    expect(ports.get(501)).toEqual([5173])
    expect(ports.get(777)).toEqual([3000])
  })

  it('reads ss', () => {
    const ports = parseSs('LISTEN 0 511 127.0.0.1:5173 0.0.0.0:* users:(("node",pid=4242,fd=23))\n')
    expect(ports.get(4242)).toEqual([5173])
  })

  it('reads netstat on Windows', () => {
    const ports = parseNetstat('  Proto  Local Address  Foreign Address  State  PID\n  TCP    0.0.0.0:3000   0.0.0.0:0   LISTENING   9120\n  TCP  127.0.0.1:5000  127.0.0.1:1  ESTABLISHED  1\n')
    expect(ports.get(9120)).toEqual([3000])
    expect(ports.size).toBe(1)
  })
})

describe('session meta', () => {
  // The scan mocked here is ps and lsof; Windows looks with PowerShell and netstat instead.
  it.skipIf(process.platform === 'win32')('shares one process scan and one branch lookup between sessions', async () => {
    vi.resetModules()
    const calls: string[] = []
    vi.doMock('node:child_process', () => ({
      execFile: (cmd: string, args: string[], _o: unknown, cb: (e: Error | null, out: string, err: string) => void) => {
        calls.push(cmd === 'git' ? args.slice(2).join(' ') : cmd)
        const out = cmd === 'ps' ? '10 1\n11 10\n' : cmd === 'lsof' ? 'p11\nn*:5173\n' : cmd === 'git' ? 'main\n' : ''
        setTimeout(() => cb(cmd === 'gh' ? new Error('no pr') : null, out, ''), 5)
      },
    }))
    const { sessionMeta } = await import('../src/main/meta')
    const metas = await Promise.all([sessionMeta('/repo', [10]), sessionMeta('/repo', [10]), sessionMeta('/other', [])])
    expect(metas[0]).toEqual({ branch: 'main', ports: [5173], pr: null })
    expect(calls.filter((c) => c === 'ps')).toHaveLength(1)
    expect(calls.filter((c) => c === 'lsof')).toHaveLength(1)
    expect(calls.filter((c) => c.startsWith('rev-parse'))).toHaveLength(2)
    // The next round still uses that scan.
    await sessionMeta('/repo', [10])
    expect(calls.filter((c) => c === 'ps')).toHaveLength(1)
    vi.doUnmock('node:child_process')
  })
})
