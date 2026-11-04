import { t } from '../../../shared/i18n'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Pane, ScreenAccess, ScreenSourceInfo, Session } from '../../../shared/types'
import * as A from '../actions'
import * as screens from '../screens'
import { store, useStore } from '../store'
import { isMac } from '../terminals'
import { Close, Monitor, Pause, Play, Refresh } from './Icons'
import { ContextMenu } from './Overlays'
import { moveItems, startPaneDrag } from './Dock'

// Screen panes: watch another window live (Unity, a simulator, the display an agent's computer use works
// on) beside the terminal driving it. Captured only while the pane is on screen, at most 15 frames a second.

type View =
  | { state: 'empty' }
  | { state: 'starting' }
  | { state: 'live' }
  /** The remembered window isn't open (yet); checked again every few seconds. */
  | { state: 'waiting' }
  | { state: 'denied' }
  | { state: 'error'; message: string }

const POLL = 3000

export function ScreenPane({ session, pane }: { session: Session; pane: Pane }) {
  const video = useRef<HTMLVideoElement>(null)
  const [view, setView] = useState<View>({ state: pane.screen ? 'starting' : 'empty' })
  const [paused, setPaused] = useState(false)
  const [current, setCurrent] = useState<ScreenSourceInfo>()
  const [menu, setMenu] = useState<{ x: number; y: number }>()
  const focused = session.focusedPane === pane.id
  const source = pane.screen
  const choose = useCallback(() => store().setUI({ screenPicker: { sessionId: session.id, paneId: pane.id } }), [session.id, pane.id])

  // Find the remembered window and show it; until it's there, look again now and then.
  useEffect(() => {
    if (!source) return setView({ state: 'empty' })
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let offEnded = () => undefined as void
    const attempt = async () => {
      if ((await window.tz.screenAccess()) !== 'granted') return alive && setView({ state: 'denied' })
      const found = screens.findSource(await window.tz.screenSources(false), source)
      if (!alive) return
      if (!found) {
        setView({ state: 'waiting' })
        timer = setTimeout(attempt, POLL)
        return
      }
      setCurrent(found)
      // Remember the window it is now (its id, a title that changed), to find it again.
      if (found.id !== source.id || found.name !== source.name || found.app !== source.app) {
        A.updatePane(session.id, pane.id, { screen: { id: found.id, kind: found.kind, name: found.name, app: found.app } })
        return
      }
      try {
        const stream = await screens.acquire(pane.id, found.id)
        if (!alive) return
        if (video.current) video.current.srcObject = stream
        setView({ state: 'live' })
        // The window closed: wait for it to come back.
        const track = stream.getVideoTracks()[0]
        const ended = () => {
          screens.end(pane.id)
          if (!alive) return
          setView({ state: 'waiting' })
          timer = setTimeout(attempt, POLL)
        }
        track?.addEventListener('ended', ended)
        offEnded = () => track?.removeEventListener('ended', ended)
      } catch (e) {
        if (alive) setView({ state: 'error', message: A.errorText(e) })
      }
    }
    setView({ state: 'starting' })
    attempt()
    return () => {
      alive = false
      clearTimeout(timer)
      offEnded()
      screens.release(pane.id)
    }
  }, [source?.id, source?.name, source?.app, source?.kind, pane.id, session.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Nothing to capture while the window is hidden or minimized, or while paused.
  useEffect(() => {
    const apply = () => {
      const off = paused || document.hidden
      screens.setPaused(pane.id, off)
      if (off) video.current?.pause()
      else video.current?.play().catch(() => undefined)
    }
    apply()
    document.addEventListener('visibilitychange', apply)
    return () => document.removeEventListener('visibilitychange', apply)
  }, [paused, pane.id, view.state])

  // The pane closed: stop at once.
  useEffect(() => () => void (!A.session(session.id)?.panes.some((p) => p.id === pane.id) && screens.end(pane.id)), [session.id, pane.id])

  const name = source ? screens.sourceLabel(source) : t('Screen')
  const live = view.state === 'live'
  return (
    <>
      <div
        className={`pane-bar ${focused ? 'focused' : ''}`}
        onMouseDown={(e) => startPaneDrag(e, session.id, pane.id, name)}
        onContextMenu={(e) => (e.preventDefault(), setMenu({ x: e.clientX, y: e.clientY }))}
      >
        <span className={`dot ${live && !paused ? 'working' : ''}`} style={live && !paused ? { animation: 'none' } : undefined} />
        <span className="label" title={name}>
          <span className="name">{name}</span>
          {paused && <span className="msg">{t('Paused')}</span>}
        </span>
        <span className="tools">
          {live && (
            <button className="icon-btn tiny" title={paused ? t('Resume') : t('Pause')} onClick={() => setPaused(!paused)}>
              {paused ? <Play size={11} /> : <Pause size={11} />}
            </button>
          )}
          {isMac && current?.canShow && (
            <button className="icon-btn tiny" title={t('Show {app}', { app: current.app ?? name })} onClick={() => window.tz.showScreenApp(current.id)}>↗</button>
          )}
          <button className="icon-btn tiny" title={t('Choose what to show')} onClick={choose}>
            <Monitor size={12} />
          </button>
        </span>
        <button className="icon-btn tiny close" title={t('Close pane')} onClick={(e) => (e.stopPropagation(), A.closePaneById(session.id, pane.id))}>
          <Close size={10} />
        </button>
      </div>
      <div className="screen-body" onDoubleClick={() => live && setPaused(!paused)}>
        <video ref={video} muted playsInline autoPlay style={{ visibility: live ? 'visible' : 'hidden' }} />
        {!live && <ScreenState view={view} name={name} onChoose={choose} onRetry={() => A.updatePane(session.id, pane.id, { screen: source && { ...source, id: undefined } })} />}
      </div>
      {menu && (
        <ContextMenu
          {...menu}
          onClose={() => setMenu(undefined)}
          items={[
            { label: t('Choose What to Show…'), run: choose },
            ...(live ? [{ label: paused ? t('Resume') : t('Pause'), run: () => setPaused(!paused) }] : []),
            ...moveItems(session.id, pane.id),
            'divider',
            { label: t('Close Pane'), danger: true, run: () => A.closePaneById(session.id, pane.id) },
          ]}
        />
      )}
    </>
  )
}

function ScreenState({ view, name, onChoose, onRetry }: { view: View; name: string; onChoose: () => void; onRetry: () => void }) {
  if (view.state === 'starting') return <div className="screen-state" />
  const [title, body] =
    view.state === 'empty' ? [t('Watch a window live'), t('Show Unity, a simulator, a browser or a whole display beside the agent working in it.')]
    : view.state === 'waiting' ? [t('Waiting for {name}', { name }), t('It shows here as soon as it opens.')]
    : view.state === 'denied' ? [t('Tezgah may not record the screen'), permissionText()]
    : [t('Can\'t show {name}', { name }), view.state === 'error' ? view.message : '']
  return (
    <div className="screen-state">
      <Monitor size={22} />
      <b>{title}</b>
      {body && <span>{body}</span>}
      <div className="buttons">
        {view.state === 'denied' && isMac && <button className="pill small primary" onClick={() => window.tz.openScreenSettings()}>{t('Open System Settings')}</button>}
        {view.state === 'error' && <button className="pill small" onClick={onRetry}>{t('Try Again')}</button>}
        <button className={`pill small ${view.state === 'empty' ? 'primary' : ''}`} onClick={onChoose}>{view.state === 'empty' ? t('Choose a Window…') : t('Choose Another…')}</button>
      </div>
    </div>
  )
}

const permissionText = () =>
  isMac
    ? t('Allow Tezgah in System Settings → Privacy & Security → Screen Recording, then quit and reopen Tezgah.')
    : t('Your desktop didn\'t allow recording the screen.')

/** Choosing a window or display for a screen pane: pictures of each, refreshed on demand. */
export function ScreenPicker() {
  const target = useStore((s) => s.ui.screenPicker)
  const [access, setAccess] = useState<ScreenAccess>()
  const [list, setList] = useState<ScreenSourceInfo[]>()
  const [error, setError] = useState<string>()

  const load = useCallback(async (ask = false) => {
    setError(undefined)
    try {
      // Asking is what makes macOS put up its question (and list Tezgah under Screen Recording).
      const items = await window.tz.screenSources(true, ask)
      setAccess(await window.tz.screenAccess())
      setList(items)
    } catch (e) {
      setError(A.errorText(e))
      setList([])
    }
  }, [])

  useEffect(() => {
    if (!target) return
    setList(undefined)
    window.tz.screenAccess().then((a) => {
      setAccess(a)
      if (a === 'granted') load()
    })
  }, [target, load])
  useEffect(() => {
    if (!target) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('keydown', key, true)
    return () => document.removeEventListener('keydown', key, true)
  }, [target]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!target) return null
  function close() {
    store().setUI({ screenPicker: undefined })
  }
  const pick = (s: ScreenSourceInfo) => {
    A.updatePane(target.sessionId, target.paneId, { screen: { id: s.id, kind: s.kind, name: s.name, app: s.app } })
    close()
  }
  const windows = list?.filter((s) => s.kind === 'window') ?? []
  const displays = list?.filter((s) => s.kind === 'screen') ?? []
  const denied = access !== undefined && access !== 'granted'
  return (
    <div className="scrim" onMouseDown={close}>
      <div onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog screen-picker">
          <div className="head">
            <b>{t('Choose what to show')}</b>
            {!denied && (
              <button className="icon-btn small" title={t('Refresh')} onClick={() => load()}>
                <Refresh size={12} />
              </button>
            )}
          </div>
          {denied ? (
            <div className="permission">
              <Monitor size={22} />
              <b>{t('Tezgah needs to record the screen to show other windows')}</b>
              <span>{isMac ? t('macOS asks once. Allow Tezgah under Privacy & Security → Screen Recording; then quit and reopen Tezgah.') : t('Your desktop didn\'t allow recording the screen.')}</span>
              <div className="buttons">
                {isMac && <button className="pill small primary" onClick={() => window.tz.openScreenSettings()}>{t('Open System Settings')}</button>}
                <button className="pill small" onClick={() => load(true)}>{t('Try Again')}</button>
              </div>
            </div>
          ) : (
            <div className="sources">
              {!list && <div className="muted">{t('Loading…')}</div>}
              {error && <div className="muted">{error}</div>}
              {list && !list.length && !error && <div className="muted">{t('No windows to show.')}</div>}
              {windows.length > 0 && <div className="group">{t('Windows')}</div>}
              <div className="grid">{windows.map((s) => <SourceCard key={s.id} source={s} onPick={pick} />)}</div>
              {displays.length > 0 && <div className="group">{t('Screens')}</div>}
              <div className="grid">{displays.map((s) => <SourceCard key={s.id} source={s} onPick={pick} />)}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SourceCard({ source, onPick }: { source: ScreenSourceInfo; onPick: (s: ScreenSourceInfo) => void }) {
  return (
    <button className="source" title={screens.sourceLabel(source)} onClick={() => onPick(source)}>
      <span className="thumb">{source.thumbnail && <img src={source.thumbnail} alt="" />}</span>
      <span className="caption">
        {source.icon && <img src={source.icon} alt="" />}
        <span>{source.app && source.kind === 'window' ? <><b>{source.app}</b> {source.name !== source.app && source.name}</> : source.name}</span>
      </span>
    </button>
  )
}
