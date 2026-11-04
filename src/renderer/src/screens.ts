import type { ScreenSource, ScreenSourceInfo } from '../../shared/types'

// Live captures for screen panes, by pane. A capture outlives its pane's view for a moment, so moving the
// pane around the layout doesn't start it again; leaving the session stops it.

/** At most this many frames a second: enough to follow along, cheap to show. */
export const FPS = 15

interface Capture {
  sourceId: string
  stream: Promise<MediaStream>
  stop?: ReturnType<typeof setTimeout>
  /** A made-up source's drawing loop. */
  timer?: ReturnType<typeof setInterval>
}

const live = new Map<string, Capture>()

export function acquire(paneId: string, sourceId: string): Promise<MediaStream> {
  const cur = live.get(paneId)
  if (cur?.sourceId === sourceId) {
    clearTimeout(cur.stop)
    cur.stop = undefined
    return cur.stream
  }
  end(paneId)
  const capture: Capture = { sourceId, stream: Promise.resolve(new MediaStream()) }
  capture.stream = sourceId.startsWith('fake:')
    ? Promise.resolve(fakeStream(sourceId, capture))
    : navigator.mediaDevices.getUserMedia({
        audio: false,
        // Chromium's desktop capture, of the source main listed; scaled down and slowed to save work.
        video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId, maxFrameRate: FPS, maxWidth: 2048, maxHeight: 2048 } },
      } as unknown as MediaStreamConstraints)
  capture.stream.catch(() => live.get(paneId) === capture && live.delete(paneId))
  live.set(paneId, capture)
  return capture.stream
}

/** The pane's view is gone: stop capturing unless it comes back (moved in the layout) right away. */
export function release(paneId: string): void {
  const cur = live.get(paneId)
  if (!cur) return
  clearTimeout(cur.stop)
  cur.stop = setTimeout(() => end(paneId), 1500)
}

export function end(paneId: string): void {
  const cur = live.get(paneId)
  if (!cur) return
  live.delete(paneId)
  clearTimeout(cur.stop)
  clearInterval(cur.timer)
  cur.stream.then((s) => s.getTracks().forEach((t) => t.stop()), () => undefined)
}

/** Paused (or not on screen): the capture stops sending frames; the view keeps the last one. */
export function setPaused(paneId: string, paused: boolean): void {
  live.get(paneId)?.stream.then((s) => s.getVideoTracks().forEach((t) => (t.enabled = !paused)), () => undefined)
}

/**
 * The source to show for a remembered one: the same window if it's still open, else one of the same app
 * with the same title, the same title, or the same app (Unity's title follows the open scene); a display
 * by its name, else the first one.
 */
export function findSource(list: ScreenSourceInfo[], want: ScreenSource): ScreenSourceInfo | undefined {
  const same = list.filter((s) => s.kind === want.kind)
  return (
    same.find((s) => s.id === want.id) ??
    same.find((s) => s.name === want.name && (!want.app || s.app === want.app)) ??
    (want.app ? same.find((s) => s.app === want.app) : undefined) ??
    (want.kind === 'screen' ? same[0] : undefined)
  )
}

/** What to call a source: "Unity · SampleScene", or just its title. */
export function sourceLabel(s: ScreenSource): string {
  return s.app && s.app !== s.name && !s.name.startsWith(s.app) ? `${s.app} · ${s.name}` : s.name
}

/** For tests without a screen to record: a drawn stand-in for the made-up sources main lists. */
function fakeStream(sourceId: string, capture: Capture): MediaStream {
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 400
  const g = canvas.getContext('2d')!
  let frame = 0
  const draw = () => {
    g.fillStyle = '#1C1B1A'
    g.fillRect(0, 0, 640, 400)
    g.fillStyle = '#2F5FD0'
    g.fillRect(40 + ((frame * 6) % 520), 260, 80, 80)
    g.fillStyle = '#F5F3F1'
    g.font = '28px sans-serif'
    g.fillText(sourceId, 40, 80)
    frame++
  }
  draw()
  capture.timer = setInterval(draw, 1000 / FPS)
  return canvas.captureStream(FPS)
}
