import { describe, expect, it } from 'vitest'
import { canMove, dockPane, dockToEdge, layoutPanes, movePane, normalize, paneDirection, paneRects, removeFromLayout, splitLayout, swapPanes } from '../src/renderer/src/layout'
import type { Layout } from '../src/shared/types'

const pane = (id: string): Layout => ({ type: 'pane', paneId: id })
const row = (...children: Layout[]): Layout => ({ type: 'split', dir: 'row', children, sizes: children.map(() => 1) })
const col = (...children: Layout[]): Layout => ({ type: 'split', dir: 'column', children, sizes: children.map(() => 1) })

/** A tree as text, sizes left out: row(a,col(b,c)). */
const shape = (l: Layout): string => (l.type === 'pane' ? l.paneId : `${l.dir === 'row' ? 'row' : 'col'}(${l.children.map(shape).join(',')})`)

describe('layout', () => {
  it('splits a single pane into two', () => {
    const l = splitLayout(pane('a'), 'a', 'b', 'row')
    expect(l).toEqual({ type: 'split', dir: 'row', children: [pane('a'), pane('b')], sizes: [1, 1] })
  })

  it('adds a sibling when splitting in the same direction, sharing the space equally', () => {
    const l = splitLayout(splitLayout(pane('a'), 'a', 'b', 'row'), 'a', 'c', 'row')
    expect(layoutPanes(l)).toEqual(['a', 'c', 'b'])
    expect(l.type === 'split' && l.sizes).toEqual([1, 1, 1])
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

  it('joins a split into its parent of the same direction, keeping each pane its share', () => {
    const l: Layout = { type: 'split', dir: 'row', children: [pane('a'), { type: 'split', dir: 'row', children: [pane('b'), pane('c')], sizes: [1, 3] }], sizes: [1, 1] }
    const n = normalize(l)
    expect(shape(n)).toBe('row(a,b,c)')
    expect(n.type === 'split' && n.sizes).toEqual([1, 0.25, 0.75])
    // Removing what held two columns apart leaves one column, not a column in a column.
    expect(shape(removeFromLayout(col(pane('a'), row(pane('b'), col(pane('c'), pane('d')))), 'b')!)).toBe('col(a,c,d)')
  })
})

describe('docking a dragged pane', () => {
  it('puts a browser below the terminal it sat beside', () => {
    expect(shape(dockPane(row(pane('term'), pane('web')), 'web', 'term', 'bottom'))).toBe('col(term,web)')
    expect(shape(dockPane(row(pane('term'), pane('web')), 'web', 'term', 'top'))).toBe('col(web,term)')
    expect(shape(dockPane(row(pane('term'), pane('web')), 'web', 'term', 'left'))).toBe('row(web,term)')
  })

  it('docks beside a pane deep in the tree, halving its share', () => {
    const l = dockPane(row(pane('a'), col(pane('b'), pane('c')), pane('d')), 'd', 'c', 'right')
    expect(shape(l)).toBe('row(a,col(b,row(c,d)))')
    const in3 = dockPane(row(pane('a'), pane('b'), pane('c')), 'c', 'a', 'right')
    expect(shape(in3)).toBe('row(a,c,b)')
    expect(in3.type === 'split' && in3.sizes).toEqual([0.5, 0.5, 1])
  })

  it('ignores a drop on itself or on a pane that is gone', () => {
    const l = row(pane('a'), pane('b'))
    expect(dockPane(l, 'a', 'a', 'left')).toBe(l)
    expect(dockPane(l, 'a', 'x', 'left')).toBe(l)
  })

  it('swaps two panes', () => {
    expect(shape(swapPanes(row(pane('a'), col(pane('b'), pane('c'))), 'a', 'c'))).toBe('row(c,col(b,a))')
  })

  it('docks along a whole edge of the layout', () => {
    expect(shape(dockToEdge(row(pane('a'), pane('b'), pane('web')), 'web', 'bottom'))).toBe('col(row(a,b),web)')
    const l = dockToEdge(col(pane('a'), pane('b'), pane('web')), 'web', 'top')
    expect(shape(l)).toBe('col(web,a,b)')
    expect(l.type === 'split' && l.sizes).toEqual([1, 1, 1])
  })
})

describe('moving a pane with the menu or keyboard', () => {
  it('trades places with its neighbour, each keeping its size', () => {
    const l: Layout = { type: 'split', dir: 'row', children: [pane('a'), pane('b')], sizes: [2, 1] }
    const m = movePane(l, 'b', 'left')
    expect(shape(m)).toBe('row(b,a)')
    expect(m.type === 'split' && m.sizes).toEqual([1, 2])
  })

  it('steps out of a nested split to that side', () => {
    expect(shape(movePane(row(pane('a'), col(pane('b'), pane('c'))), 'b', 'left'))).toBe('row(a,b,c)')
    expect(shape(movePane(col(row(pane('a'), pane('b')), pane('c')), 'b', 'bottom'))).toBe('col(a,b,c)')
    // What's left of a split that held three keeps its shape.
    expect(shape(movePane(row(pane('a'), col(pane('b'), row(pane('c'), pane('d')))), 'b', 'left'))).toBe('row(a,b,c,d)')
  })

  it('goes along the whole edge when it is already at that side', () => {
    expect(shape(movePane(row(pane('term'), pane('web')), 'web', 'bottom'))).toBe('col(term,web)')
    expect(shape(movePane(col(pane('a'), row(pane('b'), pane('c'))), 'c', 'bottom'))).toBe('col(a,b,c)')
    expect(shape(movePane(row(pane('a'), col(pane('b'), pane('c'))), 'b', 'right'))).toBe('row(a,c,b)')
  })

  it('stays put where it cannot go further', () => {
    const l = row(pane('a'), pane('b'))
    expect(movePane(l, 'a', 'left')).toBe(l)
    expect(canMove(l, 'a', 'left')).toBe(false)
    expect(canMove(l, 'a', 'right')).toBe(true)
    expect(movePane(pane('a'), 'a', 'bottom')).toEqual(pane('a'))
  })

  it('never loses or duplicates a pane', () => {
    const sides = ['left', 'right', 'top', 'bottom'] as const
    let l: Layout = row(pane('a'), col(pane('b'), row(pane('c'), pane('d'))), pane('e'))
    for (let i = 0; i < 200; i++) {
      const ids = layoutPanes(l)
      l = movePane(l, ids[(i * 7) % ids.length], sides[(i * 3) % 4])
      if (i % 5 === 0) l = dockPane(l, ids[i % ids.length], ids[(i * 3 + 1) % ids.length], sides[i % 4])
      expect([...layoutPanes(l)].sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
      // Tidy: no split with one child or inside one of its own direction; no empty sizes.
      const check = (n: Layout, parent?: string): void => {
        if (n.type === 'pane') return
        expect(n.children.length).toBeGreaterThan(1)
        expect(n.sizes.length).toBe(n.children.length)
        expect(n.sizes.every((s) => s > 0)).toBe(true)
        expect(n.dir).not.toBe(parent)
        n.children.forEach((c) => check(c, n.dir))
      }
      check(l)
    }
  })
})

describe('reading a layout', () => {
  it('tells which way a pane is joined', () => {
    expect(paneDirection(col(pane('term'), pane('web')), 'web')).toBe('column')
    expect(paneDirection(row(pane('term'), col(pane('x'), pane('web'))), 'term')).toBe('row')
    expect(paneDirection(pane('a'), 'a')).toBeUndefined()
  })

  it('places panes as fractions of the whole', () => {
    const r = paneRects({ type: 'split', dir: 'row', children: [pane('a'), col(pane('b'), pane('c'))], sizes: [1, 3] })
    expect(r.a).toEqual({ x: 0, y: 0, w: 0.25, h: 1 })
    expect(r.c).toEqual({ x: 0.25, y: 0.5, w: 0.75, h: 0.5 })
  })
})
