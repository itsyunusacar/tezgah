import type { WebviewTag } from 'electron'

// Live browser panes, so commands (the CLI, the palette) can drive the page.

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
