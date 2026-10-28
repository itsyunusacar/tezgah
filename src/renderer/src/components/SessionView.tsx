import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Diff, Layout, Session } from '../../../shared/types'
import * as A from '../actions'
import { rootRecord, sessionStatus, statusLine, useStore } from '../store'
import * as terms from '../terminals'
import { Branch, Diff as DiffIcon, Sidebar as SidebarIcon, SplitCol, SplitRow } from './Icons'
import { ChangesPanel } from './Changes'

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
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
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
  const slot = useRef<HTMLDivElement>(null)
  const rt = useStore((s) => s.panes[paneId])
  const fontSize = useStore((s) => s.settings.fontSize)
  const focused = session.focusedPane === paneId
  const multi = session.panes.length > 1
  const pane = session.panes.find((p) => p.id === paneId)

  useLayoutEffect(() => {
    const el = slot.current
    if (!el || !pane) return
    let cancelled = false
    // The startup command needs an async check (does the conversation exist yet?), so resolve it first.
    A.startCommand(pane).then((command) => {
      if (cancelled) return
      terms.attach(paneId, el, A.paneStart(session.id, paneId, command))
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

  // Claude's conversation title becomes the session title.
  const title = rootRecord(rt)?.title ?? rt?.title
  useEffect(() => {
    if (pane?.kind === 'claude' && title) A.adoptTitle(session.id, title)
  }, [title, pane?.kind, session.id])

  const blocked = rootRecord(rt)?.state === 'blocked'
  const [dropping, setDropping] = useState(false)
  return (
    <div
      className={`pane ${focused ? 'focused' : ''} ${multi ? 'multi' : ''} ${blocked ? 'blocked' : ''} ${dropping ? 'dropping' : ''}`}
      onMouseDown={() => A.focusPane(session.id, paneId)}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setDropping(true)
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDropping(false)
        const paths = [...e.dataTransfer.files].map((f) => window.tz.pathForFile(f)).filter(Boolean)
        A.focusPane(session.id, paneId)
        terms.insertPaths(paneId, paths)
      }}
    >
      <div className="term-slot" ref={slot} />
      {rt?.exited && (
        <div className="exited">
          <span>{pane?.kind === 'claude' ? 'Claude exited' : 'Process exited'}</span>
          <button className="pill small primary" onClick={() => A.restartPane(session.id, paneId)}>Restart</button>
        </div>
      )}
    </div>
  )
}
