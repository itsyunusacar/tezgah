import { t } from '../../../shared/i18n'
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import * as A from '../actions'
import { canMove, layoutPanes, type Side } from '../layout'
import { label, type Command } from '../../../shared/shortcuts'
import { isMac } from '../terminals'
import type { MenuItem } from './Overlays'

// Moving panes around: drag one by its bar and drop it on another pane's edge to dock it there, on its
// middle to swap the two, or along the edge of the whole session. Browser pages swallow mouse events, so
// while dragging a clear sheet covers every pane and works out where the pointer is.

interface Drag {
  sessionId: string
  paneId: string
  name: string
  x: number
  y: number
}

const useDrag = create<{ drag?: Drag }>(() => ({}))

/** How far the mouse goes before a press on a bar becomes a drag (a click stays a click). */
const THRESHOLD = 5
/** How close to a pane's side counts as that side, as a fraction of the pane. */
const EDGE = 0.3
/** How close to the session's own edge docks along all of it, in pixels. */
const OUTER = 18

/** Starts watching a press on a pane's bar; it becomes a drag once the mouse moves. */
export function startPaneDrag(e: React.MouseEvent, sessionId: string, paneId: string, name: string): void {
  if (e.button !== 0 || (e.target as HTMLElement).closest('button, input')) return
  const session = A.session(sessionId)
  if (!session || session.panes.length < 2) return
  const x0 = e.clientX
  const y0 = e.clientY
  const move = (m: MouseEvent) => {
    if (Math.abs(m.clientX - x0) + Math.abs(m.clientY - y0) < THRESHOLD) return
    stop()
    useDrag.setState({ drag: { sessionId, paneId, name, x: m.clientX, y: m.clientY } })
  }
  const stop = () => {
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', stop)
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', stop)
}

type Target = { kind: 'pane'; paneId: string; side: Side | 'center' } | { kind: 'edge'; side: Side }
type Box = { left: number; top: number; width: number; height: number }

/** Where a drop at (x, y) would put the pane, and the area to light up. */
function targetAt(x: number, y: number, drag: Drag): { target: Target; box: Box } | undefined {
  const area = document.querySelector('.panes')?.getBoundingClientRect()
  if (!area) return undefined
  const sides: [Side, number][] = [['left', x - area.left], ['right', area.right - x], ['top', y - area.top], ['bottom', area.bottom - y]]
  const outer = sides.filter(([, d]) => d >= 0 && d < OUTER).sort((a, b) => a[1] - b[1])[0]
  if (outer) {
    const side = outer[0]
    const w = area.width * 0.35
    const h = area.height * 0.35
    const box = {
      left: side === 'right' ? area.right - w : area.left,
      top: side === 'bottom' ? area.bottom - h : area.top,
      width: side === 'left' || side === 'right' ? w : area.width,
      height: side === 'top' || side === 'bottom' ? h : area.height,
    }
    return { target: { kind: 'edge', side }, box }
  }
  for (const el of document.querySelectorAll<HTMLElement>('.panes [data-pane]')) {
    const r = el.getBoundingClientRect()
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue
    const paneId = el.dataset.pane!
    if (paneId === drag.paneId) return undefined
    const px = (x - r.left) / r.width
    const py = (y - r.top) / r.height
    const [side, d] = ([['left', px], ['right', 1 - px], ['top', py], ['bottom', 1 - py]] as [Side, number][]).sort((a, b) => a[1] - b[1])[0]
    if (d >= EDGE) return { target: { kind: 'pane', paneId, side: 'center' }, box: { left: r.left, top: r.top, width: r.width, height: r.height } }
    const box = {
      left: side === 'right' ? r.left + r.width / 2 : r.left,
      top: side === 'bottom' ? r.top + r.height / 2 : r.top,
      width: side === 'left' || side === 'right' ? r.width / 2 : r.width,
      height: side === 'top' || side === 'bottom' ? r.height / 2 : r.height,
    }
    return { target: { kind: 'pane', paneId, side }, box }
  }
  return undefined
}

/** The sheet over the panes while one is dragged: the drop indicator and the pane's name by the pointer. */
export function DockOverlay() {
  const drag = useDrag((s) => s.drag)
  const [hit, setHit] = useState<ReturnType<typeof targetAt>>()
  const active = drag?.paneId

  useEffect(() => {
    if (!active) return setHit(undefined)
    document.body.classList.add('dragging')
    const end = () => useDrag.setState({ drag: undefined })
    const move = (e: MouseEvent) => {
      const d = useDrag.getState().drag
      if (!d) return
      useDrag.setState({ drag: { ...d, x: e.clientX, y: e.clientY } })
      setHit(targetAt(e.clientX, e.clientY, d))
    }
    const drop = (e: MouseEvent) => {
      const d = useDrag.getState().drag
      end()
      const found = d && targetAt(e.clientX, e.clientY, d)
      if (!d || !found) return
      const { target } = found
      if (target.kind === 'edge') A.dockToEdge(d.sessionId, d.paneId, target.side)
      else A.dockPane(d.sessionId, d.paneId, target.paneId, target.side)
      requestAnimationFrame(A.refocus)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      end()
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', drop)
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', end)
    return () => {
      document.body.classList.remove('dragging')
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', drop)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', end)
    }
  }, [active])

  if (!drag) return null
  return (
    <div className="dock-sheet">
      {hit && <div className={`dock-hint ${hit.target.kind === 'pane' && hit.target.side === 'center' ? 'swap' : ''}`} style={hit.box} />}
      <div className="dock-ghost" style={{ left: drag.x + 14, top: drag.y + 12 }}>
        {hit ? hintText(hit.target) : drag.name}
      </div>
    </div>
  )
}

function hintText(target: Target): string {
  if (target.kind === 'edge') return { left: t('Along the left'), right: t('Along the right'), top: t('Along the top'), bottom: t('Along the bottom') }[target.side]
  return { left: t('Left'), right: t('Right'), top: t('Above'), bottom: t('Below'), center: t('Swap') }[target.side]
}

const key = (c: Command) => label(c, isMac)

/** Move Left / Right / Up / Down and Swap, for a pane's menu; nothing for a pane on its own. */
export function moveItems(sessionId: string, paneId: string): MenuItem[] {
  const s = A.session(sessionId)
  if (!s || layoutPanes(s.layout).length < 2) return []
  const item = (text: string, side: Side, cmd: Command): MenuItem => ({
    label: text,
    hint: key(cmd),
    disabled: !canMove(s.layout, paneId, side),
    run: () => A.movePane(side, sessionId, paneId),
  })
  return [
    'divider',
    item(t('Move Left'), 'left', 'move-left'),
    item(t('Move Right'), 'right', 'move-right'),
    item(t('Move Up'), 'top', 'move-up'),
    item(t('Move Down'), 'bottom', 'move-down'),
    { label: t('Swap with Next Pane'), run: () => A.swapWithNext(sessionId, paneId) },
  ]
}
