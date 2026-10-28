import { describe, expect, it } from 'vitest'
import { paletteFrom, parseGhostty } from '../src/main/ghostty'

describe('ghostty config', () => {
  it('reads keys, skipping comments, keeping repeats', () => {
    const entries = parseGhostty('# a comment\nfont-family = "JetBrains Mono"\nfont-size=14\npalette = 0=#1d1f21\npalette = 15=ffffff\n')
    expect(entries).toEqual([['font-family', 'JetBrains Mono'], ['font-size', '14'], ['palette', '0=#1d1f21'], ['palette', '15=ffffff']])
  })

  it('builds an xterm palette', () => {
    const p = paletteFrom(parseGhostty('background = 282c34\nforeground = #abb2bf\ncursor-color = #528bff\npalette = 1=#e06c75\npalette = 99=#000000\n'))
    expect(p).toEqual({ background: '#282c34', foreground: '#abb2bf', cursor: '#528bff', red: '#e06c75' })
  })
})
