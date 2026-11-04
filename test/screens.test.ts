import { describe, expect, it } from 'vitest'
import { findSource, sourceLabel } from '../src/renderer/src/screens'
import type { ScreenSourceInfo } from '../src/shared/types'

const win = (id: string, name: string, app?: string): ScreenSourceInfo => ({ id, kind: 'window', name, app, canShow: false })
const display = (id: string, name: string): ScreenSourceInfo => ({ id, kind: 'screen', name, canShow: false })

describe('finding a remembered window again', () => {
  const list = [win('window:1:0', 'SampleScene - Unity 6', 'Unity'), win('window:2:0', 'iPhone 17', 'Simulator'), display('screen:1:0', 'Built-in Display')]

  it('takes the same window while it is open', () => {
    expect(findSource(list, { id: 'window:2:0', kind: 'window', name: 'renamed', app: 'Simulator' })?.id).toBe('window:2:0')
  })

  it('after a relaunch, finds it by app and title, then by app alone (titles follow the open file)', () => {
    expect(findSource(list, { id: 'window:99:0', kind: 'window', name: 'iPhone 17', app: 'Simulator' })?.id).toBe('window:2:0')
    expect(findSource(list, { kind: 'window', name: 'Level2 - Unity 6', app: 'Unity' })?.id).toBe('window:1:0')
  })

  it('waits when nothing like it is open', () => {
    expect(findSource(list, { kind: 'window', name: 'Blender', app: 'Blender' })).toBeUndefined()
    expect(findSource(list, { kind: 'window', name: 'Built-in Display' })).toBeUndefined()
  })

  it('falls back to the first display for a display that changed', () => {
    expect(findSource(list, { kind: 'screen', name: 'Studio Display' })?.id).toBe('screen:1:0')
  })

  it('names a window by its app and title', () => {
    expect(sourceLabel(win('w', 'iPhone 17', 'Simulator'))).toBe('Simulator · iPhone 17')
    expect(sourceLabel(win('w', 'Unity 6 - Sample', 'Unity'))).toBe('Unity 6 - Sample')
    expect(sourceLabel(display('s', 'Entire Screen'))).toBe('Entire Screen')
  })
})
