import { t } from '../../../shared/i18n'
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
  const version = useStore((s) => s.version)
  const update = useStore((s) => s.update)
  const commands = useStore((s) => s.settings.commands)

  // The + menu, like cmux's: new sessions, new panes, layouts and your commands.
  const newMenu = (): MenuItem[] => {
    const projectId = A.selected()?.projectId
    const has = !!A.selected()
    return [
      { label: t('New Claude Session'), hint: key('new-claude'), run: () => A.newSession(projectId, 'claude') },
      { label: t('New Shell Session'), hint: key('new-shell'), run: () => A.newSession(projectId, 'shell') },
      { label: t('New Session in a Worktree…'), hint: key('new-worktree'), run: () => A.newWorktreeSession(projectId) },
      { label: t('New SSH Session…'), run: () => A.newSshSession(projectId) },
      'divider',
      { label: t('New Terminal Pane'), hint: key('split-row'), disabled: !has, run: () => A.split('row') },
      { label: t('New Browser Pane'), hint: key('browser'), disabled: !has, run: () => A.openBrowserHere() },
      'divider',
      { label: t('Open Folder…'), hint: key('open-folder'), run: () => A.openFolder() },
      { label: t('Save Session as Layout…'), disabled: !has, run: () => A.saveLayout() },
      ...(layouts.length ? ([{ header: t('Layouts') }, ...layouts.map((l) => ({ label: l.name, hint: t('{n} panes', { n: l.panes.length }), run: () => A.openLayout(l.name, projectId) }))] as MenuItem[]) : []),
      ...(commands.length ? ([{ header: t('Commands') }, ...commands.map((c) => ({ label: c.name, disabled: !has, run: () => A.runCustomCommand(c.name) }))] as MenuItem[]) : []),
      'divider',
      { label: commands.length ? t('Edit Commands…') : t('Add Your Own Commands…'), run: () => setUI({ settings: true }) },
    ]
  }

  const projectMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault()
    const p = A.project(id)!
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: t('New Claude Session'), run: () => A.newSession(id, 'claude') },
        { label: t('New Shell Session'), run: () => A.newSession(id, 'shell') },
        { label: t('New Session in a Worktree…'), run: () => A.newWorktreeSession(id) },
        { label: t('New SSH Session…'), run: () => A.newSshSession(id) },
        'divider',
        { label: isMac ? t('Reveal in Finder') : t('Show in Folder'), run: () => window.tz.revealPath(p.path) },
        'divider',
        { label: t('Remove Project'), danger: true, run: () => A.removeProject(id) },
      ],
    })
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="grow" />
        <button
          className={`icon-btn ${menu?.kind === 'new' ? 'active' : ''}`}
          title={t('New…')}
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
        <button className="icon-btn" title={t('Recent conversations')} onClick={() => setUI({ recent: true })}>
          <Clock />
        </button>
        <button className="icon-btn" title={t('Settings')} onClick={() => setUI({ settings: true })}>
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
                  title={t('New session')}
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

      <div className="sidebar-foot">
        <Usage />
        {update && (
          <button className="update" title={update.url} onClick={() => window.tz.openExternal(update.url)}>
            <span className="dot" />
            {t('Tezgah {version} is out', { version: update.version })}
            <span className="go">{t('Download')}</span>
          </button>
        )}
        <button className="signature" title={t('Settings')} onClick={() => setUI({ settings: true })}>
          <Mark size={12} />
          <span>{t('tezgah')}</span>
          <span className="version">{version}</span>
        </button>
      </div>
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
        { label: t('Rename…'), run: () => A.renameSession(session.id) },
        { label: t('Restart'), run: () => A.restartPane(session.id) },
        ...(session.worktree
          ? (['divider', { label: t('Merge into {base}', { base: session.worktree.base }), run: () => A.mergeWorktree(session.id) }] as MenuItem[])
          : []),
        'divider',
        { label: t('Close Session'), danger: true, run: () => A.closeSession(session.id) },
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
          {line || lastNote?.body || (activity ? t('New output') : session.panes.length > 1 ? t('{n} panes', { n: session.panes.length }) : '')}
        </div>
        {meta && (meta.ports.length > 0 || meta.pr || (meta.branch && !session.worktree)) && (
          <div className="meta">
            {meta.branch && !session.worktree && (
              <span className="branch" title={t('Branch {name}', { name: meta.branch })}><Branch size={10} /> {meta.branch}</span>
            )}
            {meta.pr && (
              <button className={`tag pr ${meta.pr.state}`} title={`${meta.pr.title}\n${meta.pr.state} · open on GitHub`} onClick={(e) => (e.stopPropagation(), window.tz.openExternal(meta.pr!.url))}>
                #{meta.pr.number}
              </button>
            )}
            {meta.ports.map((port) => (
              <button key={port} className="tag" title={t('Open localhost:{port}', { port })} onClick={(e) => (e.stopPropagation(), A.openPort(session.id, port))}>
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
        title={t('Close session')}
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
      {agents.length > limit && <div className="agent-row">{t('+{n} more', { n: agents.length - limit })}</div>}
    </div>
  )
}
