import { describe, expect, it } from 'vitest'
import { pageResult, pageScript } from '../src/main/page-eval'

// Runs the page script the way executeJavaScript would (here in Node, without a DOM).
const run = async (script: string) => pageResult(await (0, eval)(pageScript(script)))

describe('browser eval', () => {
  it('returns an expression’s value', async () => {
    expect(await run('1 + 1')).toBe(2)
    expect(await run('({ a: [1, 2] })')).toEqual({ a: [1, 2] })
    expect(await run('Promise.resolve("x") // a comment')).toBe('x')
  })

  it('runs statements and returns what they return', async () => {
    expect(await run('const a = 2; return a * 3')).toBe(6)
    expect(await run('let x = 1; x++')).toBe('undefined')
  })

  it('runs a script that throws once, with its message', async () => {
    const g = globalThis as { tezgahRuns?: number }
    g.tezgahRuns = 0
    await expect(run('globalThis.tezgahRuns++, missing.prop')).rejects.toThrow(/ReferenceError: missing is not defined/)
    expect(g.tezgahRuns).toBe(1)
    await expect(run('globalThis.tezgahRuns++; throw new TypeError("bad")')).rejects.toThrow('TypeError: bad')
    expect(g.tezgahRuns).toBe(2)
  })

  it('reports syntax errors without running anything', () => {
    expect(() => pageScript('if (')).toThrow(/SyntaxError/)
  })

  it('turns values that can’t be cloned into text', async () => {
    expect(await run('() => 1')).toBe('() => 1')
    expect(await run('({ f() {} })')).toBe('{}')
    expect(await run('(() => { const o = { f() {} }; o.self = o; return o })()')).toBe('[object Object]')
    expect(await run('undefined')).toBe('undefined')
  })
})
