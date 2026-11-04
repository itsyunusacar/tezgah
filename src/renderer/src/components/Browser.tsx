import { t } from '../../../shared/i18n'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { WebviewTag } from 'electron'
import type { Pane, Session } from '../../../shared/types'
import * as A from '../actions'
import * as browsers from '../browsers'
import { overlayOpen, useStore } from '../store'
import { Close, Grip, Refresh } from './Icons'
import { moveItems, startPaneDrag } from './Dock'
import { ContextMenu } from './Overlays'

// Browser panes live in one layer above the panes, for as long as their session exists, and are
// positioned over their pane's slot. Moving a webview in the DOM would reload it, and agents keep
// driving pages in sessions you aren't looking at, so they never unmount while switching.

/** Where a browser pane shows on screen, kept up to date by its slot in the layout. */
export function BrowserSlot({ paneId }: { paneId: string }) {
  const el = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const node = el.current
    if (!node) return
    const update = () => {
      const r = node.getBoundingClientRect()
      browsers.setSlot(paneId, { x: r.left, y: r.top, width: r.width, height: r.height })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(node)
    window.addEventListener('resize', update)
    // Its position can change without its size (the sidebar, Changes, a neighbour's split): those come
    // from the store, so measure again once the next frame is laid out.
    let frame = 0
    const later = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }
    const off = useStore.subscribe((s, prev) => (s.ws !== prev.ws || s.ui !== prev.ui) && later())
    return () => {
      ro.disconnect()
      off()
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', update)
      browsers.setSlot(paneId, undefined)
    }
  }, [paneId])
  return <div className="browser-slot" ref={el} />
}

export function BrowserLayer() {
  const sessions = useStore((s) => s.ws.sessions)
  // Archived sessions' pages close with their other programs.
  const list = sessions.filter((s) => !s.archived).flatMap((s) => s.panes.filter((p) => p.kind === 'browser').map((p) => ({ session: s, pane: p })))
  return (
    <>
      {list.map(({ session, pane }) => (
        <BrowserFrame key={pane.id} session={session} pane={pane} />
      ))}
    </>
  )
}

function BrowserFrame({ session, pane }: { session: Session; pane: Pane }) {
  const slot = browsers.useSlot(pane.id)
  const overlay = useStore((s) => overlayOpen(s.ui))
  const view = useRef<WebviewTag>(null)
  const [address, setAddress] = useState(pane.url ?? '')
  const [nav, setNav] = useState({ back: false, forward: false, loading: false })
  const [error, setError] = useState<string>()
  const [menu, setMenu] = useState<{ x: number; y: number }>()
  const multi = session.panes.length > 1
  // The page the webview was created with; later navigation happens inside it.
  const [initial] = useState(pane.url || 'about:blank')

  useEffect(() => {
    const v = view.current
    if (!v) return
    let unregister = () => undefined as void
    const ready = () => {
      unregister()
      unregister = browsers.register(pane.id, v)
    }
    const sync = () => setNav({ back: v.canGoBack(), forward: v.canGoForward(), loading: v.isLoading() })
    const navigated = (e: Event) => {
      const { url, isMainFrame } = e as Event & { url: string; isMainFrame?: boolean }
      // An iframe moving within its page isn't the page's address.
      if (isMainFrame === false) return
      setAddress(url)
      setError(undefined)
      A.updatePane(session.id, pane.id, { url })
      sync()
    }
    const failed = (e: Event) => {
      const f = e as Event & { errorCode: number; errorDescription: string; isMainFrame: boolean; validatedURL: string }
      if (f.isMainFrame && f.errorCode !== -3) setError(`${f.validatedURL} · ${f.errorDescription}`)
    }
    const focus = () => A.focusPane(session.id, pane.id)
    v.addEventListener('dom-ready', ready)
    v.addEventListener('did-navigate', navigated)
    v.addEventListener('did-navigate-in-page', navigated)
    v.addEventListener('did-start-loading', sync)
    v.addEventListener('did-stop-loading', sync)
    v.addEventListener('did-fail-load', failed)
    v.addEventListener('focus', focus)
    return () => {
      unregister()
      v.removeEventListener('dom-ready', ready)
      v.removeEventListener('did-navigate', navigated)
      v.removeEventListener('did-navigate-in-page', navigated)
      v.removeEventListener('did-start-loading', sync)
      v.removeEventListener('did-stop-loading', sync)
      v.removeEventListener('did-fail-load', failed)
      v.removeEventListener('focus', focus)
    }
  }, [pane.id, session.id])

  // Someone else (a port click, an agent) changed the address.
  useEffect(() => {
    const v = view.current
    if (!v || !pane.url) return
    try {
      if (v.getURL() !== pane.url) v.loadURL(pane.url).catch(() => undefined)
    } catch {
      // Not attached yet; it starts at `initial`.
    }
    setAddress(pane.url)
  }, [pane.url])

  const go = (input: string) => {
    const url = A.normalizeAddress(input)
    setAddress(url)
    view.current?.loadURL(url).catch(() => undefined)
  }

  // When its pane isn't shown it sits behind the app, still on screen so the page keeps rendering
  // (agents read and capture it), and full size.
  const style: React.CSSProperties = slot
    ? { left: slot.x, top: slot.y, width: slot.width, height: slot.height, visibility: overlay ? 'hidden' : undefined }
    : { left: 0, top: 0, width: 1280, height: 800, zIndex: -1 }

  return (
    <div className={`browser-frame ${slot ? '' : 'parked'}`} style={style}>
      <div
        className="browser-bar"
        onMouseDown={(e) => startPaneDrag(e, session.id, pane.id, t('Browser'))}
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest('input')) return
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
      >
        {multi && (
          <span className="grip" title={t('Drag to move · click for options')} onClick={(e) => setMenu({ x: e.clientX, y: e.clientY })}>
            <Grip />
          </span>
        )}
        <button className="icon-btn small" title={t('Back')} disabled={!nav.back} onClick={() => view.current?.goBack()}>←</button>
        <button className="icon-btn small" title={t('Forward')} disabled={!nav.forward} onClick={() => view.current?.goForward()}>→</button>
        <button className="icon-btn small" title={nav.loading ? t('Stop') : t('Reload')} onClick={() => (nav.loading ? view.current?.stop() : view.current?.reload())}>
          {nav.loading ? <Close size={11} /> : <Refresh size={12} />}
        </button>
        <input
          className="address"
          value={address}
          spellCheck={false}
          onChange={(e) => setAddress(e.target.value)}
          onFocus={(e) => (e.target.select(), A.focusPane(session.id, pane.id))}
          onKeyDown={(e) => e.key === 'Enter' && go(address)}
        />
        <button className="icon-btn small" title={t('Open in your browser')} onClick={() => window.tz.openExternal(address)}>↗</button>
        <button className="icon-btn small" title={t('Developer tools')} onClick={() => view.current?.openDevTools()}>{'</>'}</button>
        <button className="icon-btn small" title={t('Close')} onClick={() => A.closePaneById(session.id, pane.id)}><Close size={11} /></button>
        {menu && (
          <ContextMenu
            {...menu}
            onClose={() => setMenu(undefined)}
            items={[
              { label: t('Reload'), run: () => view.current?.reload() },
              { label: t('Open in your browser'), run: () => window.tz.openExternal(address) },
              ...moveItems(session.id, pane.id),
              'divider',
              { label: t('Close Pane'), danger: true, run: () => A.closePaneById(session.id, pane.id) },
            ]}
          />
        )}
      </div>
      <div className="browser-body">
        <webview ref={view} src={initial} partition="persist:browser" allowpopups={'' as unknown as boolean} webpreferences="backgroundThrottling=no" />
        {error && (
          <div className="browser-error">
            <b>{t('Can\'t open this page')}</b>
            <span>{error}</span>
            <button className="pill small" onClick={() => view.current?.reload()}>{t('Try Again')}</button>
          </div>
        )}
      </div>
    </div>
  )
}
