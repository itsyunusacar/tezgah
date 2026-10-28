import type { WebviewTag } from 'electron'
import { create } from 'zustand'

// Live browser panes, so commands (the CLI, MCP tools, the palette) can drive the page,
// and where each one's pane is on screen.

const views = new Map<string, WebviewTag>()

export function register(paneId: string, view: WebviewTag): () => void {
  views.set(paneId, view)
  return () => {
    if (views.get(paneId) === view) views.delete(paneId)
  }
}

export function get(paneId: string): WebviewTag | undefined {
  return views.get(paneId)
}

/** The page's webContents id, for the main process to drive it; undefined until it has loaded once. */
export function contentsId(paneId: string): number | undefined {
  try {
    return views.get(paneId)?.getWebContentsId()
  } catch {
    return undefined
  }
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

const slots = create<Record<string, Rect | undefined>>(() => ({}))

export function setSlot(paneId: string, rect: Rect | undefined): void {
  const cur = slots.getState()[paneId]
  if (cur && rect && cur.x === rect.x && cur.y === rect.y && cur.width === rect.width && cur.height === rect.height) return
  if (!cur && !rect) return
  slots.setState({ [paneId]: rect })
}

export const useSlot = (paneId: string) => slots((s) => s[paneId])
