import { describe, expect, it } from 'vitest'
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
