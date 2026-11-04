import { t } from '../../../shared/i18n'
import { useRef, useState } from 'react'
import type { Session, SubAgent } from '../../../shared/types'
import * as A from '../actions'
import { TERMINALS, isTerminal, sessionStatus, statusLine, useStore } from '../store'
import { isMac } from '../terminals'
import { Bell, Branch, Chevron, Clock, Close, Gear, Mark, Pin, Plus, Search } from './Icons'
import { search } from '../search'
import { ContextMenu, type MenuItem } from './Overlays'
import { label, type Command } from '../../../shared/shortcuts'

const key = (c: Command) => label(c, isMac)
import { Usage } from './Usage'

/** The session being dragged. Sessions reorder within their project only: their shells, worktree and
 *  conversation belong to its folder. (A drag's data can't be read until the drop.) */
let dragging: { id: string; projectId: string } | undefined

const prStates = { open: 'Open pull request', draft: 'Draft pull request', merged: 'Merged pull request', closed: 'Closed pull request' }

export function Sidebar() {
  const projects = useStore((s) => s.ws.projects)
  // Re-render when sessions change; the lists below read them in order from the store.
  useStore((s) => s.ws.sessions)
  const setUI = useStore((s) => s.setUI)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[]; kind?: string }>()
  const [dropOn, setDropOn] = useState<string>()
  const [openArchive, setOpenArchive] = useState<Record<string, boolean>>({})
  const [terminalsClosed, setTerminalsClosed] = useState(false)
  const [query, setQuery] = useState('')
  const field = useRef<HTMLInputElement>(null)
  const home = useStore((s) => s.home)
  const searchable = useStore((s) => s.ws.projects.length > 0 || s.ws.sessions.length > 0)
  const found = searchable && query.trim() ? search(useStore.getState().ws, query, t('Terminals'), home) : undefined
  const unread = useStore((s) => {
    const live = A.liveSessionIds(s.ws.sessions)
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
      { label: t('New Terminal'), hint: key('new-terminal'), run: () => A.newTerminal() },
      { label: t('New Session in a Worktree…'), hint: key('new-worktree'), run: () => A.newWorktreeSession(projectId) },
      { label: t('New SSH Session…'), run: () => A.newSshSession(projectId) },
      'divider',
      { label: t('New Terminal Pane'), hint: key('split-row'), disabled: !has, run: () => A.split('row') },
      { label: t('New Browser Pane'), hint: key('browser'), disabled: !has, run: () => A.openBrowserHere() },
      { label: t('New Screen Pane…'), hint: key('screen'), disabled: !has, run: () => A.openScreen() },
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

  // A group's archived sessions, under a toggle.
  const archivedRows = (id: string, archived: Session[]) =>
    archived.length > 0 && (
      <>
        <button className="archive-toggle" onClick={() => setOpenArchive((o) => ({ ...o, [id]: !o[id] }))}>
          <span className={`chev ${openArchive[id] ? '' : 'closed'}`}><Chevron size={8} /></span>
          {t('Archived ({n})', { n: archived.length })}
        </button>
        {openArchive[id] &&
          archived.map((s) => (
            <div
              key={s.id}
              className="archived-row"
              title={t('Restore')}
              tabIndex={0}
              onClick={() => A.restoreSession(s.id)}
              onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && A.restoreSession(s.id)}
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
    )

  const terminals = A.projectSessions(TERMINALS)
  const archivedTerminals = A.projectSessions(TERMINALS, true)

  // Enter in the search field: the first session found, or the first project found (its first session or a new one).
  const openFirst = () => {
    const first = found?.find((f) => f.sessions.length || f.project)
    if (!first) return
    setQuery('')
    field.current?.blur()
    if (first.sessions[0]) A.select(first.sessions[0].id)
    else if (first.project) void A.openFolder(first.project.path)
    requestAnimationFrame(A.refocus)
  }

  const results = found && (
    found.length ? (
      found.map((f) => (
        <div key={f.project?.id ?? 'terminals'}>
          <div
            className="project-row"
            title={f.project?.path}
            onClick={() => f.project && (setQuery(''), void A.openFolder(f.project.path))}
            onContextMenu={(e) => f.project && projectMenu(e, f.project.id)}
          >
            <span className="name">{f.project?.name ?? t('Terminals')}</span>
            {f.project && !f.sessions.length && <span className="hint">{t('Open')}</span>}
          </div>
          {f.sessions.map((s) => <SessionRow key={s.id} session={s} onMenu={setMenu} dropOn={dropOn} setDropOn={setDropOn} />)}
        </div>
      ))
    ) : (
      <div className="search-empty">{t('No project or session matches “{query}”.', { query: query.trim() })}</div>
    )
  )

  return (
    <aside
      className="sidebar"
      onKeyDown={(e) => {
        // "/" anywhere in the sidebar (but a text field) goes to the search field.
        if (e.key === '/' && !(e.target instanceof HTMLInputElement) && field.current) {
          e.preventDefault()
          field.current.focus()
        }
      }}
    >
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
        <button className="icon-btn bell" title={t('Notifications ({keys})', { keys: key('inbox') })} onClick={() => setUI({ inbox: true })}>
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

      {searchable && (
        <div className="sidebar-search">
          <Search size={13} />
          <input
            ref={field}
            value={query}
            placeholder={t('Find a project or session')}
            aria-label={t('Find a project or session')}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') openFirst()
              else if (e.key === 'ArrowDown') (e.preventDefault(), document.querySelector<HTMLElement>('.sidebar-list .session-row')?.focus())
              else if (e.key === 'Escape') {
                if (query) setQuery('')
                else (field.current?.blur(), requestAnimationFrame(A.refocus))
              }
            }}
          />
          {query ? (
            <button className="icon-btn tiny" title={t('Clear (Esc)')} onClick={() => (setQuery(''), field.current?.focus())}>
              <Close size={10} />
            </button>
          ) : (
            <span className="keys">{key('find-project')}</span>
          )}
        </div>
      )}

      <div className="sidebar-list">
        {results}
        {!found && (
          <>
            {(terminals.length > 0 || archivedTerminals.length > 0) && (
              <div className="terminals">
                <div
                  className={`project-row ${dropOn === 'p:' ? 'drop' : ''}`}
                  onDragOver={(e) => {
                    if (!e.dataTransfer.types.includes('text/tezgah-session') || dragging?.projectId !== TERMINALS) return
                    e.preventDefault()
                    setDropOn('p:')
                  }}
                  onDragLeave={() => setDropOn(undefined)}
                  onDrop={(e) => {
                    setDropOn(undefined)
                    const id = e.dataTransfer.getData('text/tezgah-session')
                    if (id && A.session(id)?.projectId === TERMINALS) A.moveSession(id, undefined)
                  }}
                  onClick={() => setTerminalsClosed(!terminalsClosed)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setMenu({
                      x: e.clientX,
                      y: e.clientY,
                      items: [
                        { label: t('New Terminal'), hint: key('new-terminal'), run: () => A.newTerminal() },
                        { label: t('New SSH Session…'), run: () => A.newSshSession(TERMINALS) },
                      ],
                    })
                  }}
                  title={t('Terminals outside any project, in your home folder')}
                >
                  <span className={`chev ${terminalsClosed ? 'closed' : ''}`}>
                    <Chevron />
                  </span>
                  <span className="name">{t('Terminals')}</span>
                  <button
                    className="icon-btn small"
                    title={t('New terminal ({keys})', { keys: key('new-terminal') })}
                    onClick={(e) => {
                      e.stopPropagation()
                      A.newTerminal()
                    }}
                  >
                    <Plus size={12} />
                  </button>
                </div>
                {!terminalsClosed && terminals.map((s) => <SessionRow key={s.id} session={s} onMenu={setMenu} dropOn={dropOn} setDropOn={setDropOn} />)}
                {!terminalsClosed && archivedRows(TERMINALS, archivedTerminals)}
              </div>
            )}
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
                      if (kinds.includes('text/tezgah-session') && dragging?.projectId !== p.id) return
                      e.preventDefault()
                      setDropOn('p:' + p.id)
                    }}
                    onDragLeave={() => setDropOn(undefined)}
                    onDrop={(e) => {
                      setDropOn(undefined)
                      const project = e.dataTransfer.getData('text/tezgah-project')
                      const sessionId = e.dataTransfer.getData('text/tezgah-session')
                      if (project) A.moveProject(project, p.id)
                      // A session dropped on its project goes to the end of it.
                      else if (sessionId && A.session(sessionId)?.projectId === p.id) A.moveSession(sessionId, undefined)
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
                  {!p.collapsed && archivedRows(p.id, archived)}
                </div>
              )
            })}
          </>
        )}
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
        <button className="signature" title="tezgah.itsyunusacar.com" onClick={() => window.tz.openExternal('https://tezgah.itsyunusacar.com')}>
          <Mark size={12} />
          <span>{t('tezgah')}</span>
          <span className="version">{version} beta</span>
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
  // A terminal belongs to no project: its ports show, not the branch of whatever folder it started in.
  const meta = useStore((s) => s.meta[session.id])
  const repo = !isTerminal(session)
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
        dragging = { id: session.id, projectId: session.projectId }
      }}
      onDragEnd={() => (dragging = undefined)}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('text/tezgah-session') || dragging?.projectId !== session.projectId) return
        e.preventDefault()
        e.stopPropagation()
        setDropOn('s:' + session.id)
      }}
      onDragLeave={() => setDropOn(undefined)}
      onDrop={(e) => {
        e.stopPropagation()
        setDropOn(undefined)
        const id = e.dataTransfer.getData('text/tezgah-session')
        // Dropped on a row of its project: it goes just before it.
        if (id) A.moveSession(id, session.id)
      }}
      tabIndex={0}
      onClick={() => (A.select(session.id), requestAnimationFrame(A.refocus))}
      onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && A.select(session.id)}
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
        {meta && (meta.ports.length > 0 || (repo && (meta.pr || (meta.branch && !session.worktree)))) && (
          <div className="meta">
            {repo && meta.branch && !session.worktree && (
              <span className="branch" title={t('Branch {name}', { name: meta.branch })}><Branch size={10} /> {meta.branch}</span>
            )}
            {repo && meta.pr && (
              <button className={`tag pr ${meta.pr.state}`} title={`${meta.pr.title}\n${t(prStates[meta.pr.state])} · ${t('click to open on GitHub')}`} onClick={(e) => (e.stopPropagation(), window.tz.openExternal(meta.pr!.url))}>
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
              {t('Allow')}
            </button>
            <button className="pill small" onClick={(e) => (e.stopPropagation(), A.answer(session.id, false))}>
              {t('Deny')}
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
          title={`${a.type} · ${a.description}${a.activity ? '\n' + a.activity : ''}\n${t('Click to follow along')}`}
          onClick={(e) => (e.stopPropagation(), useStore.getState().setUI({ agent: { claudeId: a.claudeId, id: a.id } }))}
        >
          <span className={`dot ${a.running ? 'working' : 'done'}`} />
          <span className="what">{a.description}</span>
          <span className="tool">{a.running ? a.activity?.split(' ')[0] ?? t('starting') : t('done')}</span>
        </div>
      ))}
      {agents.length > limit && <div className="agent-row">{t('+{n} more', { n: agents.length - limit })}</div>}
    </div>
  )
}
