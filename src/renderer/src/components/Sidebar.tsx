import { t } from '../../../shared/i18n'
import { useState } from 'react'
import type { Session, SubAgent } from '../../../shared/types'
import * as A from '../actions'
import { sessionStatus, statusLine, useStore } from '../store'
import { isMac } from '../terminals'
import { Bell, Branch, Chevron, Clock, Close, Gear, Mark, Pin, Plus } from './Icons'
import { ContextMenu, type MenuItem } from './Overlays'
import { label, type Command } from '../../../shared/shortcuts'

const key = (c: Command) => label(c, isMac)
import { Usage } from './Usage'

export function Sidebar() {
  const projects = useStore((s) => s.ws.projects)
  // Re-render when sessions change; the lists below read them in order from the store.
  useStore((s) => s.ws.sessions)
  const setUI = useStore((s) => s.setUI)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[]; kind?: string }>()
  const [dropOn, setDropOn] = useState<string>()
  const [openArchive, setOpenArchive] = useState<Record<string, boolean>>({})
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
          const list = A.projectSessions(p.id)
          const archived = A.projectSessions(p.id, true)
          return (
            <div key={p.id}>
              <div
                className={`project-row ${dropOn === 'p:' + p.id ? 'drop' : ''}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/tezgah-project', p.id)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onDragOver={(e) => {
                  const kinds = e.dataTransfer.types
                  if (!kinds.includes('text/tezgah-project') && !kinds.includes('text/tezgah-session')) return
                  e.preventDefault()
                  setDropOn('p:' + p.id)
                }}
                onDragLeave={() => setDropOn(undefined)}
                onDrop={(e) => {
                  setDropOn(undefined)
                  const project = e.dataTransfer.getData('text/tezgah-project')
                  const sessionId = e.dataTransfer.getData('text/tezgah-session')
                  if (project) A.moveProject(project, p.id)
                  // A session dropped on a project goes to the end of it.
                  else if (sessionId) A.moveSession(sessionId, undefined, p.id)
                }}
                onClick={() => A.toggleProject(p.id)}
                onContextMenu={(e) => projectMenu(e, p.id)}
                title={p.path}
              >
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
              {!p.collapsed && list.map((s) => <SessionRow key={s.id} session={s} onMenu={setMenu} dropOn={dropOn} setDropOn={setDropOn} />)}
              {!p.collapsed && archived.length > 0 && (
                <>
                  <button className="archive-toggle" onClick={() => setOpenArchive((o) => ({ ...o, [p.id]: !o[p.id] }))}>
                    <span className={`chev ${openArchive[p.id] ? '' : 'closed'}`}><Chevron size={8} /></span>
                    {t('Archived ({n})', { n: archived.length })}
                  </button>
                  {openArchive[p.id] &&
                    archived.map((s) => (
                      <div
                        key={s.id}
                        className="archived-row"
                        title={t('Restore')}
                        onClick={() => A.restoreSession(s.id)}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          setMenu({
                            x: e.clientX,
                            y: e.clientY,
                            items: [
                              { label: t('Restore'), run: () => A.restoreSession(s.id) },
                              'divider',
                              { label: t('Delete'), danger: true, run: () => A.closeSession(s.id, true) },
                            ],
                          })
                        }}
                      >
                        <span className="title">{s.title}</span>
                        <span className="restore">{t('Restore')}</span>
                      </div>
                    ))}
                </>
              )}
            </div>
          )
        })}
      </div>

      <div className="sidebar-foot">
        <Usage />
        {update?.ready ? (
          <button className="update" title={t('Installs when you quit Tezgah. Restart installs it now.')} onClick={() => window.tz.installUpdate()}>
            <span className="dot" />
            {t('Tezgah {version} is ready', { version: update.version })}
            <span className="go">{t('Restart')}</span>
          </button>
        ) : update && (
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

function SessionRow({
  session,
  onMenu,
  dropOn,
  setDropOn,
}: {
  session: Session
  onMenu: (m: { x: number; y: number; items: MenuItem[] }) => void
  dropOn?: string
  setDropOn: (id: string | undefined) => void
}) {
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
        { label: session.pinned ? t('Unpin') : t('Pin to Top'), run: () => A.togglePin(session.id) },
        { label: t('Restart'), run: () => A.restartPane(session.id) },
        ...(session.worktree
          ? (['divider', { label: t('Merge into {base}', { base: session.worktree.base }), run: () => A.mergeWorktree(session.id) }] as MenuItem[])
          : []),
        'divider',
        { label: t('Archive'), run: () => A.archiveSession(session.id) },
        { label: t('Close Session'), danger: true, run: () => A.closeSession(session.id) },
      ],
    })
  }

  return (
    <div
      className={`session-row ${selected ? 'selected' : ''} ${dropOn === 's:' + session.id ? 'drop' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/tezgah-session', session.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('text/tezgah-session')) return
        e.preventDefault()
        e.stopPropagation()
        setDropOn('s:' + session.id)
      }}
      onDragLeave={() => setDropOn(undefined)}
      onDrop={(e) => {
        e.stopPropagation()
        setDropOn(undefined)
        const id = e.dataTransfer.getData('text/tezgah-session')
        // Dropped on a row: it goes just before it, in that row's project.
        if (id) A.moveSession(id, session.id, session.projectId)
      }}
      onClick={() => A.select(session.id)}
      onDoubleClick={() => A.renameSession(session.id)}
      onContextMenu={menu}
    >
      {ring && <span className="ring" />}
      <span className={`dot ${status === 'done' && !unseen ? '' : status ?? ''}`} />
      <div className="body">
        <div className="title">
          {session.pinned && <span className="pin" title={t('Pinned')}><Pin size={10} /></span>}
          {session.title}
        </div>
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
