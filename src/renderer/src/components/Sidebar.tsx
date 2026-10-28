import { useState } from 'react'
import type { Session, SubAgent } from '../../../shared/types'
import * as A from '../actions'
import { sessionStatus, statusLine, useStore } from '../store'
import { isMac } from '../terminals'
import { Bell, Branch, Chevron, Clock, Close, Gear, Mark, Plus } from './Icons'
import { ContextMenu, type MenuItem } from './Overlays'
import { label, type Command } from '../../../shared/shortcuts'

const key = (c: Command) => label(c, isMac)
import { Usage } from './Usage'

export function Sidebar() {
  const projects = useStore((s) => s.ws.projects)
  const sessions = useStore((s) => s.ws.sessions)
  const setUI = useStore((s) => s.setUI)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[]; kind?: string }>()
  const unread = useStore((s) => {
    const live = new Set(s.ws.sessions.map((x) => x.id))
    return s.notes.filter((n) => !n.read && live.has(n.sessionId)).length
  })
  const layouts = useStore((s) => s.settings.layouts)
  const commands = useStore((s) => s.settings.commands)

  // The + menu, like cmux's: new sessions, new panes, layouts and your commands.
  const newMenu = (): MenuItem[] => {
    const projectId = A.selected()?.projectId
    const has = !!A.selected()
    return [
      { label: 'New Claude Session', hint: key('new-claude'), run: () => A.newSession(projectId, 'claude') },
      { label: 'New Shell Session', hint: key('new-shell'), run: () => A.newSession(projectId, 'shell') },
      { label: 'New Session in a Worktree…', hint: key('new-worktree'), run: () => A.newWorktreeSession(projectId) },
      { label: 'New SSH Session…', run: () => A.newSshSession(projectId) },
      'divider',
      { label: 'New Terminal Pane', hint: key('split-row'), disabled: !has, run: () => A.split('row') },
      { label: 'New Browser Pane', hint: key('browser'), disabled: !has, run: () => A.openBrowserHere() },
      'divider',
      { label: 'Open Folder…', hint: key('open-folder'), run: () => A.openFolder() },
      { label: 'Save Session as Layout…', disabled: !has, run: () => A.saveLayout() },
      ...(layouts.length ? ([{ header: 'Layouts' }, ...layouts.map((l) => ({ label: l.name, hint: `${l.panes.length} panes`, run: () => A.openLayout(l.name, projectId) }))] as MenuItem[]) : []),
      ...(commands.length ? ([{ header: 'Commands' }, ...commands.map((c) => ({ label: c.name, disabled: !has, run: () => A.runCustomCommand(c.name) }))] as MenuItem[]) : []),
      'divider',
      { label: commands.length ? 'Edit Commands…' : 'Add Your Own Commands…', run: () => setUI({ settings: true }) },
    ]
  }

  const projectMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault()
    const p = A.project(id)!
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'New Claude Session', run: () => A.newSession(id, 'claude') },
        { label: 'New Shell Session', run: () => A.newSession(id, 'shell') },
        { label: 'New Session in a Worktree…', run: () => A.newWorktreeSession(id) },
        { label: 'New SSH Session…', run: () => A.newSshSession(id) },
        'divider',
        { label: isMac ? 'Reveal in Finder' : 'Show in Folder', run: () => window.tz.revealPath(p.path) },
        'divider',
        { label: 'Remove Project', danger: true, run: () => A.removeProject(id) },
      ],
    })
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="brand">
          <Mark size={18} />
          <span>tezgah</span>
        </div>
        <button
          className={`icon-btn ${menu?.kind === 'new' ? 'active' : ''}`}
          title="New…"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            setMenu({ kind: 'new', x: r.left, y: r.bottom + 4, items: newMenu() })
          }}
        >
          <Plus size={15} />
        </button>
        <button className="icon-btn bell" title={`Notifications (${key('inbox')})`} onClick={() => setUI({ inbox: true })}>
          <Bell />
          {unread > 0 && <span className="count">{unread > 9 ? '9+' : unread}</span>}
        </button>
        <button className="icon-btn" title="Recent conversations" onClick={() => setUI({ recent: true })}>
          <Clock />
        </button>
        <button className="icon-btn" title="Settings" onClick={() => setUI({ settings: true })}>
          <Gear />
        </button>
      </div>

      <div className="sidebar-list">
        {projects.map((p) => {
          const list = sessions.filter((s) => s.projectId === p.id).sort((a, b) => a.createdAt - b.createdAt)
          return (
            <div key={p.id}>
              <div className="project-row" onClick={() => A.toggleProject(p.id)} onContextMenu={(e) => projectMenu(e, p.id)} title={p.path}>
                <span className={`chev ${p.collapsed ? 'closed' : ''}`}>
                  <Chevron />
                </span>
                <span className="name">{p.name}</span>
                <button
                  className="icon-btn small"
                  title="New session"
                  onClick={(e) => {
                    e.stopPropagation()
                    A.newSession(p.id, 'claude')
                  }}
                >
                  <Plus size={12} />
                </button>
              </div>
              {!p.collapsed && list.map((s) => <SessionRow key={s.id} session={s} onMenu={setMenu} />)}
            </div>
          )
        })}
      </div>

      <Usage />
      {menu && <ContextMenu {...menu} onClose={() => setMenu(undefined)} />}
    </aside>
  )
}

function SessionRow({ session, onMenu }: { session: Session; onMenu: (m: { x: number; y: number; items: MenuItem[] }) => void }) {
  const selected = useStore((s) => s.ws.selectedSession === session.id)
  const panes = useStore((s) => s.panes)
  const agents = useStore((s) => s.agents[session.id]) ?? []
  const unseen = useStore((s) => s.unseen[session.id])
  const status = sessionStatus(session, panes)
  const blocked = status === 'blocked'
  const permission = blocked && session.panes.some((p) => panes[p.id]?.records.find((r) => r.id === '')?.kind === 'permission')
  const line = statusLine(session, panes, agents)
  const activity = !selected && session.panes.some((p) => panes[p.id]?.activity)
  const ring = !blocked && session.panes.some((p) => panes[p.id]?.attention)
  const meta = useStore((s) => s.meta[session.id])
  const lastNote = useStore((s) => s.notes.findLast((n) => n.sessionId === session.id && n.kind === 'notice'))

  const menu = (e: React.MouseEvent) => {
    e.preventDefault()
    onMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Rename…', run: () => A.renameSession(session.id) },
        { label: 'Restart', run: () => A.restartPane(session.id) },
        ...(session.worktree
          ? (['divider', { label: `Merge into ${session.worktree.base}`, run: () => A.mergeWorktree(session.id) }] as MenuItem[])
          : []),
        'divider',
        { label: 'Close Session', danger: true, run: () => A.closeSession(session.id) },
      ],
    })
  }

  return (
    <div
      className={`session-row ${selected ? 'selected' : ''}`}
      onClick={() => A.select(session.id)}
      onDoubleClick={() => A.renameSession(session.id)}
      onContextMenu={menu}
    >
      {ring && <span className="ring" />}
      <span className={`dot ${status === 'done' && !unseen ? '' : status ?? ''}`} />
      <div className="body">
        <div className="title">{session.title}</div>
        <div className="sub">
          {session.worktree && (
            <span className="branch">
              <Branch size={10} /> {session.worktree.branch}
              {line ? ' · ' : ''}
            </span>
          )}
          {line || lastNote?.body || (activity ? 'New output' : session.panes.length > 1 ? `${session.panes.length} panes` : '')}
        </div>
        {meta && (meta.ports.length > 0 || meta.pr || (meta.branch && !session.worktree)) && (
          <div className="meta">
            {meta.branch && !session.worktree && (
              <span className="branch" title={`Branch ${meta.branch}`}><Branch size={10} /> {meta.branch}</span>
            )}
            {meta.pr && (
              <button className={`tag pr ${meta.pr.state}`} title={`${meta.pr.title}\n${meta.pr.state} · open on GitHub`} onClick={(e) => (e.stopPropagation(), window.tz.openExternal(meta.pr!.url))}>
                #{meta.pr.number}
              </button>
            )}
            {meta.ports.map((port) => (
              <button key={port} className="tag" title={`Open localhost:${port}`} onClick={(e) => (e.stopPropagation(), A.openPort(session.id, port))}>
                :{port}
              </button>
            ))}
          </div>
        )}
        {blocked && permission && (
          <div className="actions">
            <button className="pill small primary" onClick={(e) => (e.stopPropagation(), A.answer(session.id, true))}>
              Allow
            </button>
            <button className="pill small" onClick={(e) => (e.stopPropagation(), A.answer(session.id, false))}>
              Deny
            </button>
          </div>
        )}
        {agents.length > 0 && (selected ? <AgentRows agents={agents} /> : null)}
      </div>
      {!selected && agents.filter((a) => a.running).length > 0 && (
        <span className="badge">{agents.filter((a) => a.running).length}↻</span>
      )}
      <button
        className="icon-btn tiny row-close"
        title="Close session"
        onClick={(e) => {
          e.stopPropagation()
          A.closeSession(session.id)
        }}
      >
        <Close size={10} />
      </button>
    </div>
  )
}

export function AgentRows({ agents, limit = 6 }: { agents: SubAgent[]; limit?: number }) {
  const shown = agents.slice(-limit)
  return (
    <div className="agent-rows">
      {shown.map((a) => (
        <div
          className="agent-row"
          key={a.id}
          title={`${a.type} · ${a.description}${a.activity ? '\n' + a.activity : ''}\nClick to follow along`}
          onClick={(e) => (e.stopPropagation(), useStore.getState().setUI({ agent: { claudeId: a.claudeId, id: a.id } }))}
        >
          <span className={`dot ${a.running ? 'working' : 'done'}`} />
          <span className="what">{a.description}</span>
          <span className="tool">{a.running ? a.activity?.split(' ')[0] ?? 'starting' : 'done'}</span>
        </div>
      ))}
      {agents.length > limit && <div className="agent-row">+{agents.length - limit} more</div>}
    </div>
  )
}
