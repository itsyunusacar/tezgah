import type { Layout } from '../../shared/types'

// A session's split tree: panes side by side (row) or stacked (column), each split's children sharing its
// space by `sizes`. Pure functions, so dragging, docking and moving panes can be tested on their own.

type Split = Extract<Layout, { type: 'split' }>
export type Side = 'left' | 'right' | 'top' | 'bottom'

const leaf = (paneId: string): Layout => ({ type: 'pane', paneId })
/** The split direction a side lies along, and whether it comes first in it. */
const axis = (side: Side): Split['dir'] => (side === 'left' || side === 'right' ? 'row' : 'column')
const first = (side: Side) => side === 'left' || side === 'top'
const sum = (n: number[]) => n.reduce((a, b) => a + b, 0)

export function layoutPanes(l: Layout): string[] {
  return l.type === 'pane' ? [l.paneId] : l.children.flatMap(layoutPanes)
}

const contains = (l: Layout, paneId: string) => layoutPanes(l).includes(paneId)

/** Splits `target` in `dir`, putting `newId` after it. */
export function splitLayout(l: Layout, target: string, newId: string, dir: 'row' | 'column'): Layout {
  if (l.type === 'pane') {
    if (l.paneId !== target) return l
    return { type: 'split', dir, children: [l, leaf(newId)], sizes: [1, 1] }
  }
  const i = l.children.findIndex((c) => c.type === 'pane' && c.paneId === target)
  if (i >= 0 && l.dir === dir) {
    const children = [...l.children]
    children.splice(i + 1, 0, leaf(newId))
    // Everything in the row (or column) shares the space equally, so repeated splits don't shrink one corner.
    return { ...l, children, sizes: children.map(() => 1) }
  }
  return { ...l, children: l.children.map((c) => splitLayout(c, target, newId, dir)) }
}

/**
 * Tidies a tree: a split with one child is that child, and a split inside another of the same direction
 * joins it, its children keeping the share of the space they had.
 */
export function normalize(l: Layout): Layout {
  if (l.type === 'pane') return l
  const children: Layout[] = []
  const sizes: number[] = []
  l.children.forEach((raw, i) => {
    const c = normalize(raw)
    const share = l.sizes[i] > 0 ? l.sizes[i] : 1
    if (c.type === 'split' && c.dir === l.dir) {
      const total = sum(c.sizes) || 1
      c.children.forEach((cc, j) => (children.push(cc), sizes.push((share * c.sizes[j]) / total)))
    } else {
      children.push(c)
      sizes.push(share)
    }
  })
  if (children.length === 1) return children[0]
  return { ...l, children, sizes }
}

export function removeFromLayout(l: Layout, paneId: string): Layout | undefined {
  if (l.type === 'pane') return l.paneId === paneId ? undefined : l
  const kept: Layout[] = []
  const sizes: number[] = []
  l.children.forEach((c, i) => {
    const next = removeFromLayout(c, paneId)
    if (next) {
      kept.push(next)
      sizes.push(l.sizes[i])
    }
  })
  if (kept.length === 0) return undefined
  return normalize({ ...l, children: kept, sizes })
}

/** Exchanges two panes' places. */
export function swapPanes(l: Layout, a: string, b: string): Layout {
  if (l.type === 'pane') return l.paneId === a ? leaf(b) : l.paneId === b ? leaf(a) : l
  return { ...l, children: l.children.map((c) => swapPanes(c, a, b)) }
}

/** Puts `paneId` (not yet in the tree) on one side of `target`, sharing the target's space. */
function insertBeside(l: Layout, paneId: string, target: string, side: Side): Layout {
  const dir = axis(side)
  if (l.type === 'pane') {
    if (l.paneId !== target) return l
    return { type: 'split', dir, children: first(side) ? [leaf(paneId), l] : [l, leaf(paneId)], sizes: [1, 1] }
  }
  const i = l.children.findIndex((c) => c.type === 'pane' && c.paneId === target)
  if (i >= 0 && l.dir === dir) {
    // Beside a pane in a split of the same direction: the two halve the pane's share.
    const children = [...l.children]
    const sizes = [...l.sizes]
    const half = (sizes[i] || 1) / 2
    sizes[i] = half
    const at = first(side) ? i : i + 1
    children.splice(at, 0, leaf(paneId))
    sizes.splice(at, 0, half)
    return { ...l, children, sizes }
  }
  return { ...l, children: l.children.map((c) => insertBeside(c, paneId, target, side)) }
}

/** Puts `paneId` (not yet in the tree) along one edge of the whole layout, full width or full height. */
function insertAtEdge(l: Layout, paneId: string, side: Side): Layout {
  const dir = axis(side)
  if (l.type === 'split' && l.dir === dir) {
    // One more in the row or column, with an average share.
    const share = sum(l.sizes) / l.sizes.length
    return first(side)
      ? { ...l, children: [leaf(paneId), ...l.children], sizes: [share, ...l.sizes] }
      : { ...l, children: [...l.children, leaf(paneId)], sizes: [...l.sizes, share] }
  }
  return { type: 'split', dir, children: first(side) ? [leaf(paneId), l] : [l, leaf(paneId)], sizes: [1, 1] }
}

/** Drag and drop: `moving` leaves its place and docks on `side` of `target`. */
export function dockPane(l: Layout, moving: string, target: string, side: Side): Layout {
  if (moving === target || !contains(l, moving) || !contains(l, target)) return l
  const rest = removeFromLayout(l, moving)
  return rest ? normalize(insertBeside(rest, moving, target, side)) : l
}

/** `paneId` leaves its place for one edge of the whole layout ("browser at the bottom"). */
export function dockToEdge(l: Layout, paneId: string, side: Side): Layout {
  if (!contains(l, paneId)) return l
  const rest = removeFromLayout(l, paneId)
  return rest ? normalize(insertAtEdge(rest, paneId, side)) : l
}

/** The splits from the root down to `paneId`, with the index taken at each. */
function pathTo(l: Layout, paneId: string): { split: Split; index: number }[] | undefined {
  if (l.type === 'pane') return l.paneId === paneId ? [] : undefined
  for (let i = 0; i < l.children.length; i++) {
    const rest = pathTo(l.children[i], paneId)
    if (rest) return [{ split: l, index: i }, ...rest]
  }
  return undefined
}

/**
 * Move Left / Right / Up / Down, one step at a time: a pane trades places with its neighbour in its row
 * (or column); a pane nested in a split steps out of it to that side; a pane already at that edge of its
 * splits goes along the whole layout's edge. Already there: unchanged.
 */
export function movePane(l: Layout, paneId: string, side: Side): Layout {
  const path = pathTo(l, paneId)
  if (!path || !path.length) return l
  const dir = axis(side)
  const step = first(side) ? -1 : 1
  // The nearest split along that direction where the pane isn't at the edge yet.
  for (let depth = path.length - 1; depth >= 0; depth--) {
    const { split, index } = path[depth]
    if (split.dir !== dir) continue
    const next = index + step
    if (next < 0 || next >= split.children.length) continue
    if (depth === path.length - 1) {
      // Its own row: trade places with the neighbour, each keeping its size.
      const children = [...split.children]
      const sizes = [...split.sizes]
      ;[children[index], children[next]] = [children[next], children[index]]
      ;[sizes[index], sizes[next]] = [sizes[next], sizes[index]]
      return replaceSplit(l, split, { ...split, children, sizes })
    }
    // Out of the split it's in, to that side of it, with an average share.
    const children = [...split.children]
    const sizes = [...split.sizes]
    children[index] = without(children[index], paneId)
    const at = step < 0 ? index : index + 1
    children.splice(at, 0, leaf(paneId))
    sizes.splice(at, 0, sum(sizes) / sizes.length)
    return normalize(replaceSplit(l, split, { ...split, children, sizes }))
  }
  // At the edge already: along the whole layout's edge, unless it's alone there.
  if (l.type === 'split' && l.dir === dir && path.length === 1) return l
  return dockToEdge(l, paneId, side)
}

/** The tree without a pane, left untidy (normalize after); the pane must not be all of it. */
function without(l: Layout, paneId: string): Layout {
  if (l.type === 'pane') return l
  const keep = l.children.map((c, i) => [c, l.sizes[i]] as const).filter(([c]) => !(c.type === 'pane' && c.paneId === paneId))
  return { ...l, children: keep.map(([c]) => without(c, paneId)), sizes: keep.map(([, s]) => s) }
}

function replaceSplit(l: Layout, from: Split, to: Split): Layout {
  if (l === from) return to
  if (l.type === 'pane') return l
  return { ...l, children: l.children.map((c) => replaceSplit(c, from, to)) }
}

/** Which way a pane is joined to the rest: beside it (row) or above or below it (column). */
export function paneDirection(l: Layout, paneId: string): Split['dir'] | undefined {
  const path = pathTo(l, paneId)
  return path?.length ? path[path.length - 1].split.dir : undefined
}

/** Where each pane sits, as fractions of the whole (0…1). */
export function paneRects(l: Layout, box = { x: 0, y: 0, w: 1, h: 1 }): Record<string, { x: number; y: number; w: number; h: number }> {
  if (l.type === 'pane') return { [l.paneId]: box }
  const total = sum(l.sizes) || 1
  let at = 0
  const out: ReturnType<typeof paneRects> = {}
  l.children.forEach((c, i) => {
    const f = l.sizes[i] / total
    const sub = l.dir === 'row' ? { x: box.x + at * box.w, y: box.y, w: f * box.w, h: box.h } : { x: box.x, y: box.y + at * box.h, w: box.w, h: f * box.h }
    at += f
    Object.assign(out, paneRects(c, sub))
  })
  return out
}

/** Whether moving a pane that way changes anything (for greying out menu items). */
export const canMove = (l: Layout, paneId: string, side: Side): boolean => JSON.stringify(movePane(l, paneId, side)) !== JSON.stringify(l)
