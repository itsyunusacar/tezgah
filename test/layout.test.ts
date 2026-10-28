import { describe, expect, it, vi } from 'vitest'
vi.stubGlobal('window', { tz: {} })
const { layoutPanes, removeFromLayout, splitLayout } = await import('../src/renderer/src/store')
import type { Layout } from '../src/shared/types'

const pane = (id: string): Layout => ({ type: 'pane', paneId: id })

describe('layout', () => {
  it('splits a single pane into two', () => {
    const l = splitLayout(pane('a'), 'a', 'b', 'row')
    expect(l).toEqual({ type: 'split', dir: 'row', children: [pane('a'), pane('b')], sizes: [1, 1] })
  })

  it('adds a sibling when splitting in the same direction, halving the target', () => {
    const l = splitLayout(splitLayout(pane('a'), 'a', 'b', 'row'), 'a', 'c', 'row')
    expect(layoutPanes(l)).toEqual(['a', 'c', 'b'])
    expect(l.type === 'split' && l.sizes).toEqual([0.5, 0.5, 1])
  })

  it('nests when splitting in the other direction', () => {
    const l = splitLayout(splitLayout(pane('a'), 'a', 'b', 'row'), 'b', 'c', 'column')
    expect(layoutPanes(l)).toEqual(['a', 'b', 'c'])
    expect(l.type === 'split' && l.children[1].type).toBe('split')
  })

  it('collapses a split when one child is left', () => {
    const l = splitLayout(pane('a'), 'a', 'b', 'row')
    expect(removeFromLayout(l, 'b')).toEqual(pane('a'))
    expect(removeFromLayout(pane('a'), 'a')).toBeUndefined()
  })
})
