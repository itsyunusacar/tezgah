import { useEffect, useRef, useState } from 'react'
import type { WebviewTag } from 'electron'
import type { Pane, Session } from '../../../shared/types'
import * as A from '../actions'
import * as browsers from '../browsers'
import { Close, Refresh } from './Icons'

/** A web page beside the terminal: a dev server, docs, a PR. */
export function BrowserPane({ session, pane }: { session: Session; pane: Pane }) {
  const view = useRef<WebviewTag>(null)
  const [address, setAddress] = useState(pane.url ?? '')
  const [nav, setNav] = useState({ back: false, forward: false, loading: false })
  const [error, setError] = useState<string>()
  // The page the webview was created with; later navigation happens inside it.
  const [initial] = useState(pane.url || 'about:blank')

  useEffect(() => {
    const v = view.current
    if (!v) return
    const unregister = browsers.register(pane.id, v)
    const sync = () => {
      setNav({ back: v.canGoBack(), forward: v.canGoForward(), loading: v.isLoading() })
    }
    const navigated = (e: Event) => {
      const url = (e as Event & { url: string }).url
      setAddress(url)
      setError(undefined)
      A.updatePane(session.id, pane.id, { url })
      sync()
    }
    const failed = (e: Event) => {
      const f = e as Event & { errorCode: number; errorDescription: string; isMainFrame: boolean; validatedURL: string }
      if (f.isMainFrame && f.errorCode !== -3) setError(`${f.validatedURL} · ${f.errorDescription}`)
    }
    v.addEventListener('did-navigate', navigated)
    v.addEventListener('did-navigate-in-page', navigated)
    v.addEventListener('did-start-loading', sync)
    v.addEventListener('did-stop-loading', sync)
    v.addEventListener('did-fail-load', failed)
    v.addEventListener('focus', () => A.focusPane(session.id, pane.id))
    return () => {
      unregister()
      v.removeEventListener('did-navigate', navigated)
      v.removeEventListener('did-navigate-in-page', navigated)
      v.removeEventListener('did-start-loading', sync)
      v.removeEventListener('did-stop-loading', sync)
      v.removeEventListener('did-fail-load', failed)
    }
  }, [pane.id, session.id])

  // Someone else (a port click, the CLI) changed the address.
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

  return (
    <div className="browser">
      <div className="browser-bar">
        <button className="icon-btn small" title="Back" disabled={!nav.back} onClick={() => view.current?.goBack()}>←</button>
        <button className="icon-btn small" title="Forward" disabled={!nav.forward} onClick={() => view.current?.goForward()}>→</button>
        <button className="icon-btn small" title={nav.loading ? 'Stop' : 'Reload'} onClick={() => (nav.loading ? view.current?.stop() : view.current?.reload())}>
          {nav.loading ? <Close size={11} /> : <Refresh size={12} />}
        </button>
        <input
          className="address"
          value={address}
          spellCheck={false}
          onChange={(e) => setAddress(e.target.value)}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => e.key === 'Enter' && go(address)}
        />
        <button className="icon-btn small" title="Open in your browser" onClick={() => window.tz.openExternal(address)}>↗</button>
        <button className="icon-btn small" title="Developer tools" onClick={() => view.current?.openDevTools()}>{'</>'}</button>
      </div>
      <div className="browser-body">
        <webview ref={view} src={initial} partition="persist:browser" allowpopups={'' as unknown as boolean} />
        {error && (
          <div className="browser-error">
            <b>Can't open this page</b>
            <span>{error}</span>
            <button className="pill small" onClick={() => view.current?.reload()}>Try Again</button>
          </div>
        )}
      </div>
    </div>
  )
}
