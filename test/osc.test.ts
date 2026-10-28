import { describe, expect, it } from 'vitest'
import { applyReport, parseOsc7501 } from '../src/renderer/src/osc'

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64')

describe('OSC 7501', () => {
  it('parses a blocked permission report with decoded text', () => {
    const r = parseOsc7501(`state=blocked:kind=permission:app=claude-code:title=${b64('Fix checkout')}:msg=${b64('Bash: npm test')}`)
    expect(r).toEqual({
      clear: false,
      record: { id: '', state: 'blocked', kind: 'permission', app: 'claude-code', title: 'Fix checkout', message: 'Bash: npm test' },
    })
  })

  it('keeps kind only for blocked states', () => {
    const r = parseOsc7501('state=working:kind=permission')
    expect(r && !r.clear && r.record.kind).toBeUndefined()
  })

  it('reads subagent ids and clear reports', () => {
    const r = parseOsc7501('id=agent-1:state=working')
    expect(r && !r.clear && r.record.id).toBe('agent-1')
    expect(parseOsc7501('state=clear:id=agent-1')).toEqual({ clear: true, id: 'agent-1' })
  })

  it('rejects malformed ids and unknown states', () => {
    expect(parseOsc7501('id=bad*id:state=working')).toBeUndefined()
    expect(parseOsc7501('state=sleeping')).toBeUndefined()
  })

  it('strips control and bidi characters from text', () => {
    const r = parseOsc7501(`state=working:msg=${b64('a\u001b[31mb‮c')}`)
    expect(r && !r.clear && r.record.message).toBe('a [31mb c')
  })

  it('replaces records by id and clears descendants', () => {
    let recs = applyReport([], parseOsc7501('state=working')!)
    recs = applyReport(recs, parseOsc7501('id=a:state=working')!)
    recs = applyReport(recs, parseOsc7501('id=a/b:state=working')!)
    recs = applyReport(recs, parseOsc7501('state=blocked:kind=question')!)
    expect(recs.map((r) => `${r.id}:${r.state}`)).toEqual(['a:working', 'a/b:working', ':blocked'])
    recs = applyReport(recs, { clear: true, id: 'a' })
    expect(recs.map((r) => r.id)).toEqual([''])
    expect(applyReport(recs, { clear: true, id: '' })).toEqual([])
  })
})
