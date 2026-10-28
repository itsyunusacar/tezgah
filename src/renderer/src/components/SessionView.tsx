import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Diff, Layout, Pane, Session } from '../../../shared/types'
import * as A from '../actions'
import { type PaneRuntime, rootRecord, sessionStatus, statusLine, useStore } from '../store'
import { agentName } from '../activity'
import { ContextMenu } from './Overlays'
import { label, type Command } from '../../../shared/shortcuts'

const key = (c: Command) => label(c, terms.isMac)
import * as terms from '../terminals'
import { Branch, Close, Globe, Diff as DiffIcon, Sidebar as SidebarIcon, SplitCol, SplitRow } from './Icons'
import { ChangesPanel } from './Changes'
import { BrowserSlot } from './Browser'

export function SessionView({ session }: { session: Session }) {
  const panes = useStore((s) => s.panes)
  const agents = useStore((s) => s.agents[session.id]) ?? []
  const ui = useStore((s) => s.ui)
  const setUI = useStore((s) => s.setUI)
  const project = A.project(session.projectId)
  const [diff, setDiff] = useState<Diff | null>(null)
  const line = statusLine(session, panes, agents)
  const status = sessionStatus(session, panes)

  // Header counts and the Changes panel share one diff, refreshed while the session is on screen.
  useEffect(() => {
    let alive = true
    const cwd = session.worktree?.path ?? project?.path
    const load = () => cwd && window.tz.diff(cwd, session.worktree?.base).then((d) => alive && setDiff(d))
    load()
    const t = setInterval(load, status === 'working' ? 3000 : 8000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [session.id, session.worktree, project?.path, status])

  const added = diff?.files.reduce((n, f) => n + f.added, 0) ?? 0
  const removed = diff?.files.reduce((n, f) => n + f.removed, 0) ?? 0

  return (
    <div className="main">
      <div className="header">
        {!ui.sidebar && (
          <button className="icon-btn" title="Show sidebar" onClick={() => setUI({ sidebar: true })}>
            <SidebarIcon />
          </button>
        )}
        <span className={`dot ${status ?? ''}`} style={{ marginTop: 0 }} />
        <span className="title">{session.title}</span>
        <span className="status">{line || session.worktree?.path || project?.path}</span>
        {agents.some((a) => a.running) && (
          <span className="chip" title={agents.map((a) => `${a.running ? '●' : '○'} ${a.description}`).join('\n')}>
            {agents.filter((a) => a.running).length} agents
          </span>
        )}
        {session.worktree && (
          <span className="chip" title={`${session.worktree.path}\nbased on ${session.worktree.base}`}>
            <Branch /> {session.worktree.branch}
          </span>
        )}
        {diff && diff.files.length > 0 && (
          <button className={`pill ${ui.changes ? 'primary' : ''}`} onClick={() => setUI({ changes: !ui.changes })} title="Changes">
            <DiffIcon size={13} />
            <span>
              {diff.files.length} · <span style={{ color: ui.changes ? undefined : 'var(--add)' }}>+{added}</span>{' '}
              <span style={{ color: ui.changes ? undefined : 'var(--del)' }}>−{removed}</span>
            </span>
          </button>
        )}
        <button className="icon-btn" title="Open browser" onClick={() => A.openBrowserHere()}>
          <Globe />
        </button>
        <button className="icon-btn" title="Split right" onClick={() => A.split('row')}>
          <SplitRow />
        </button>
        <button className="icon-btn" title="Split down" onClick={() => A.split('column')}>
          <SplitCol />
        </button>
      </div>
      <div className="workspace">
        <div className="panes">
          <LayoutView session={session} layout={session.layout} path={[]} />
        </div>
        {ui.changes && <ChangesPanel session={session} diff={diff} onRefresh={() => {
          const cwd = session.worktree?.path ?? project?.path
          if (cwd) window.tz.diff(cwd, session.worktree?.base).then(setDiff)
        }} />}
      </div>
    </div>
  )
}

function LayoutView({ session, layout, path }: { session: Session; layout: Layout; path: number[] }) {
  if (layout.type === 'pane') return <PaneView session={session} paneId={layout.paneId} />
  return <SplitView session={session} layout={layout} path={path} />
}

function SplitView({ session, layout, path }: { session: Session; layout: Extract<Layout, { type: 'split' }>; path: number[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const total = layout.sizes.reduce((a, b) => a + b, 0)

  const drag = (i: number) => (e: React.MouseEvent) => {
    e.preventDefault()
    const box = ref.current!.getBoundingClientRect()
    const horizontal = layout.dir === 'row'
    const length = horizontal ? box.width : box.height
    const start = horizontal ? e.clientX : e.clientY
    const sizes = [...layout.sizes]
    const pair = sizes[i] + sizes[i + 1]
    const move = (m: MouseEvent) => {
      const delta = (((horizontal ? m.clientX : m.clientY) - start) / length) * total
      const minimum = (120 / length) * total
      const a = Math.min(Math.max(layout.sizes[i] + delta, minimum), pair - minimum)
      const next = [...sizes]
      next[i] = a
      next[i + 1] = pair - a
      A.setSizes(session.id, path, next)
    }
    const up = () => {
      document.body.classList.remove('dragging')
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    document.body.classList.add('dragging')
  }

  return (
    <div className={`split dir-${layout.dir}`} ref={ref}>
      {layout.children.map((child, i) => (
        <Cell key={child.type === 'pane' ? child.paneId : i} grow={layout.sizes[i] / total} divider={i < layout.children.length - 1} onDrag={drag(i)}>
          <LayoutView session={session} layout={child} path={[...path, i]} />
        </Cell>
      ))}
    </div>
  )
}

function Cell({ grow, divider, onDrag, children }: { grow: number; divider: boolean; onDrag: (e: React.MouseEvent) => void; children: React.ReactNode }) {
  return (
    <>
      <div className="cell" style={{ flex: `${grow} 1 0` }}>{children}</div>
      {divider && <div className="divider" onMouseDown={onDrag} />}
    </>
  )
}

function PaneView({ session, paneId }: { session: Session; paneId: string }) {
  const rt = useStore((s) => s.panes[paneId])
  const focused = session.focusedPane === paneId
  const multi = session.panes.length > 1
  const pane = session.panes.find((p) => p.id === paneId)

  // Claude's conversation title becomes the session title.
  const title = rootRecord(rt)?.title ?? rt?.title
  useEffect(() => {
    if (pane?.kind === 'claude' && title) A.adoptTitle(session.id, title)
  }, [title, pane?.kind, session.id])

  const blocked = rootRecord(rt)?.state === 'blocked'
  const ring = !blocked && rt?.attention
  const finding = useStore((s) => s.ui.find === paneId)
  const [dropping, setDropping] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number }>()
  if (!pane) return null
  const browser = pane.kind === 'browser'
  return (
    <div
      onContextMenu={(e) => {
        if (browser) return
        e.preventDefault()
        A.focusPane(session.id, paneId)
        setMenu({ x: e.clientX, y: e.clientY })
      }}
      className={`pane ${browser ? 'web' : ''} ${multi && !browser ? 'has-bar' : ''} ${focused ? 'focused' : ''} ${multi ? 'multi' : ''} ${blocked ? 'blocked' : ''} ${ring ? 'attention' : ''} ${dropping ? 'dropping' : ''}`}
      onMouseDown={() => A.focusPane(session.id, paneId)}
      onDragOver={(e) => {
        if (browser || !e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setDropping(true)
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        if (browser) return
        e.preventDefault()
        setDropping(false)
        const paths = [...e.dataTransfer.files].map((f) => window.tz.pathForFile(f)).filter(Boolean)
        A.focusPane(session.id, paneId)
        A.dropFiles(session.id, paneId, paths)
      }}
    >
      {multi && !browser && <PaneBar session={session} pane={pane} />}
      {browser ? <BrowserSlot paneId={paneId} /> : <TerminalSlot session={session} pane={pane} focused={focused} />}
      {finding && !browser && <FindBar paneId={paneId} />}
      {menu && (
        <ContextMenu
          {...menu}
          onClose={() => setMenu(undefined)}
          items={[
            { label: 'Split Right', hint: key('split-row'), run: () => A.split('row', 'shell', {}, session.id) },
            { label: 'Split Down', hint: key('split-column'), run: () => A.split('column', 'shell', {}, session.id) },
            { label: 'Open Browser Beside', hint: key('browser'), run: () => A.openBrowserHere() },
            'divider',
            { label: 'Find…', hint: key('find'), run: () => useStore.getState().setUI({ find: paneId }) },
            { label: 'Clear', hint: key('clear'), run: () => terms.clear(paneId) },
            { label: 'Restart', run: () => A.restartPane(session.id, paneId) },
            'divider',
            { label: multi ? 'Close Pane' : 'Close Session', hint: key('close-pane'), danger: true, run: () => A.closePaneById(session.id, paneId) },
          ]}
        />
      )}
      {rt?.exited && (
        <div className="exited">
          <span>{pane.kind === 'claude' ? 'Claude exited' : 'Process exited'}</span>
          <button className="pill small primary" onClick={() => A.restartPane(session.id, paneId)}>Restart</button>
        </div>
      )}
    </div>
  )
}

/** What a pane is, in a word: Claude, the agent running in it, or its command. */
function paneName(pane: Pane, rt?: PaneRuntime): string {
  if (pane.kind === 'claude') return 'Claude'
  const app = rootRecord(rt)?.app
  if (app && app !== 'claude') return agentName(app)
  if (pane.ssh) return pane.ssh
  if (pane.command) return pane.command.split(/\s+/).slice(0, 3).join(' ')
  return 'Terminal'
}

/** The strip above each pane of a split: what runs there, and split / close. */
function PaneBar({ session, pane }: { session: Session; pane: Pane }) {
  const rt = useStore((s) => s.panes[pane.id])
  const focused = session.focusedPane === pane.id
  const rec = rootRecord(rt)
  const state = rt?.exited ? 'exited' : rec?.state
  return (
    <div className={`pane-bar ${focused ? 'focused' : ''}`} onDoubleClick={() => A.split('row', 'shell', {}, session.id)}>
      <span className={`dot ${state ?? ''}`} />
      <span className="name">{paneName(pane, rt)}</span>
      {rec?.message && <span className="msg">{rec.message}</span>}
      <span className="grow" />
      <button className="icon-btn tiny" title="Split right" onClick={(e) => (e.stopPropagation(), A.focusPane(session.id, pane.id), A.split('row', 'shell', {}, session.id))}>
        <SplitRow size={12} />
      </button>
      <button className="icon-btn tiny" title="Split down" onClick={(e) => (e.stopPropagation(), A.focusPane(session.id, pane.id), A.split('column', 'shell', {}, session.id))}>
        <SplitCol size={12} />
      </button>
      <button className="icon-btn tiny" title={`Close pane (${key('close-pane')})`} onClick={(e) => (e.stopPropagation(), A.closePaneById(session.id, pane.id))}>
        <Close size={10} />
      </button>
    </div>
  )
}

function TerminalSlot({ session, pane, focused }: { session: Session; pane: Pane; focused: boolean }) {
  const slot = useRef<HTMLDivElement>(null)
  const fontSize = useStore((s) => s.settings.fontSize)
  const paneId = pane.id

  useLayoutEffect(() => {
    const el = slot.current
    if (!el) return
    let cancelled = false
    // The startup command needs an async check (does the conversation exist yet?), so resolve it first.
    // Shells come back with what they showed last time; Claude restores its own conversation.
    const restore = pane.kind === 'claude' ? Promise.resolve(undefined) : window.tz.loadScrollback(paneId)
    Promise.all([A.startCommand(pane), restore]).then(([command, saved]) => {
      if (cancelled) return
      terms.attach(paneId, el, A.paneStart(session.id, paneId, command), saved)
      if (focused) terms.focus(paneId)
    })
    const ro = new ResizeObserver(() => terms.fit(paneId))
    ro.observe(el)
    return () => {
      cancelled = true
      ro.disconnect()
      terms.detach(paneId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId])

  useEffect(() => {
    if (focused) terms.focus(paneId)
  }, [focused, paneId])
  useEffect(() => terms.fit(paneId), [fontSize, paneId])

  return <div className="term-slot" ref={slot} />
}

function FindBar({ paneId }: { paneId: string }) {
  const [query, setQuery] = useState('')
  const [caseSensitive, setCase] = useState(false)
  const [result, setResult] = useState<{ index: number; count: number }>()
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
    const off = terms.onSearchResults(paneId, (index, count) => setResult({ index, count }))
    return () => {
      off()
      terms.endFind(paneId)
    }
  }, [paneId])
  useEffect(() => {
    if (!query) {
      terms.endFind(paneId)
      setResult(undefined)
    } else terms.find(paneId, query, false, { caseSensitive })
  }, [query, caseSensitive, paneId])

  const close = () => {
    useStore.getState().setUI({ find: undefined })
    terms.focus(paneId)
  }
  return (
    <div className="find-bar" onMouseDown={(e) => e.stopPropagation()}>
      <input
        ref={input}
        value={query}
        placeholder="Find"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close()
          if (e.key === 'Enter') terms.find(paneId, query, e.shiftKey, { caseSensitive })
        }}
      />
      <span className="count">{query ? (result && result.count > 0 ? `${result.index + 1}/${result.count}` : 'No results') : ''}</span>
      <button className={`icon-btn small ${caseSensitive ? 'active' : ''}`} title="Match case" onClick={() => setCase(!caseSensitive)}>Aa</button>
      <button className="icon-btn small" title="Previous (Shift+Enter)" onClick={() => terms.find(paneId, query, true, { caseSensitive })}>↑</button>
      <button className="icon-btn small" title="Next (Enter)" onClick={() => terms.find(paneId, query, false, { caseSensitive })}>↓</button>
      <button className="icon-btn small" title="Close (Esc)" onClick={close}><Close size={11} /></button>
    </div>
  )
}
