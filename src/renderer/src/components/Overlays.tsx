import { useEffect, useMemo, useRef, useState } from 'react'
import type { RecentConversation } from '../../../shared/types'
import * as A from '../actions'
import { sessionStatus, statusLine, store, useStore } from '../store'
import { isMac } from '../terminals'
import { Search } from './Icons'
import { label, type Command } from '../../../shared/shortcuts'

export type MenuItem = { label: string; danger?: boolean; run: () => void } | 'divider'

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  useEffect(() => {
    const close = () => onClose()
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
    }
  }, [onClose])
  return (
    <div className="menu" style={{ left: Math.min(x, window.innerWidth - 220), top: Math.min(y, window.innerHeight - items.length * 32 - 12) }} onMouseDown={(e) => e.stopPropagation()}>
      {items.map((it, i) =>
        it === 'divider' ? (
          <hr key={i} />
        ) : (
          <button key={i} className={it.danger ? 'danger' : ''} onClick={() => (onClose(), it.run())}>
            {it.label}
          </button>
        ),
      )}
    </div>
  )
}

function Scrim({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [onClose])
  return (
    <div className="scrim" onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()}>{children}</div>
    </div>
  )
}

export function PromptDialog() {
  const prompt = useStore((s) => s.ui.prompt)
  const [value, setValue] = useState('')
  useEffect(() => setValue(prompt?.value ?? ''), [prompt])
  if (!prompt) return null
  const close = () => store().setUI({ prompt: undefined })
  const submit = () => {
    close()
    prompt.onSubmit(value)
  }
  return (
    <Scrim onClose={close}>
      <div className="dialog small">
        <div className="dialog-body">
          <h2>{prompt.title}</h2>
          <input className="field" autoFocus value={value} placeholder={prompt.placeholder} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} onFocus={(e) => e.target.select()} />
        </div>
        <div className="dialog-actions">
          <button className="pill" onClick={close}>Cancel</button>
          <button className="pill primary" onClick={submit} disabled={!value.trim()}>{prompt.confirm}</button>
        </div>
      </div>
    </Scrim>
  )
}

export function ConfirmDialog() {
  const confirm = useStore((s) => s.ui.confirm)
  if (!confirm) return null
  const close = () => store().setUI({ confirm: undefined })
  return (
    <Scrim onClose={close}>
      <div className="dialog small">
        <div className="dialog-body">
          <h2>{confirm.title}</h2>
          <p>{confirm.body}</p>
        </div>
        <div className="dialog-actions">
          <button className="pill" onClick={close}>Cancel</button>
          {confirm.actions.map((a, i) => (
            <button key={a.label} autoFocus={i === confirm.actions.length - 1} className={`pill ${a.danger ? 'danger' : 'primary'}`} onClick={() => (close(), a.run())}>
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </Scrim>
  )
}

export function Toast() {
  const toast = useStore((s) => s.ui.toast)
  return toast ? <div className="toast">{toast}</div> : null
}

// A searchable list, shared by the quick switcher and recent conversations.

interface Row {
  key: string
  text: string
  hint?: string
  run: () => void
}

function Picker({ placeholder, rows, onClose, empty }: { placeholder: string; rows: Row[]; onClose: () => void; empty: string }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    return rows.filter((r) => words.every((w) => `${r.text} ${r.hint ?? ''}`.toLowerCase().includes(w))).slice(0, 80)
  }, [rows, query])
  useEffect(() => setActive(0), [query])
  useEffect(() => {
    list.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])
  const run = (r?: Row) => {
    if (!r) return
    onClose()
    r.run()
  }
  return (
    <Scrim onClose={onClose}>
      <div className="dialog">
        <div className="search">
          <Search />
          <input
            autoFocus
            placeholder={placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(a + 1, shown.length - 1)))
              if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)))
              if (e.key === 'Enter') run(shown[active])
            }}
          />
        </div>
        <div className="items" ref={list}>
          {shown.map((r, i) => (
            <div key={r.key} className={`item ${i === active ? 'active' : ''}`} onMouseMove={() => setActive(i)} onClick={() => run(r)}>
              <span className="main-text">{r.text}</span>
              {r.hint && <span className="hint">{r.hint}</span>}
            </div>
          ))}
          {!shown.length && <div className="muted">{empty}</div>}
        </div>
      </div>
    </Scrim>
  )
}

const key = (c: Command) => label(c, isMac)

export function Palette() {
  const open = useStore((s) => s.ui.palette)
  const ws = useStore((s) => s.ws)
  const panes = useStore((s) => s.panes)
  if (!open) return null
  const rows: Row[] = [
    ...A.orderedSessions().map((s) => ({
      key: s.id,
      text: s.title,
      hint: [A.project(s.projectId)?.name, statusLine(s, panes) || (sessionStatus(s, panes) === 'exited' ? 'Stopped' : '')].filter(Boolean).join(' · '),
      run: () => A.select(s.id),
    })),
    ...ws.projects.map((p) => ({ key: 'new-' + p.id, text: `New session in ${p.name}`, hint: key('new-claude'), run: () => A.newSession(p.id, 'claude') })),
    { key: 'open', text: 'Open folder…', hint: key('open-folder'), run: () => A.openFolder() },
    { key: 'recent', text: 'Recent conversations…', hint: key('recent'), run: () => store().setUI({ recent: true }) },
    { key: 'wt', text: 'New session in a worktree…', hint: key('new-worktree'), run: () => A.newWorktreeSession() },
    { key: 'inbox', text: 'Notifications', hint: key('inbox'), run: () => store().setUI({ inbox: true }) },
    { key: 'find', text: 'Find in terminal', hint: key('find'), run: () => A.selected() && store().setUI({ find: A.selected()!.focusedPane }) },
    { key: 'settings', text: 'Settings', hint: key('settings'), run: () => store().setUI({ settings: true }) },
  ]
  return <Picker placeholder="Go to a session or run a command" rows={rows} onClose={() => store().setUI({ palette: false })} empty="No match" />
}

export function ago(t: number): string {
  const m = Math.round((Date.now() - t) / 60000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m ago`
  if (m < 1440) return `${Math.round(m / 60)}h ago`
  return `${Math.round(m / 1440)}d ago`
}

export function RecentDialog() {
  const open = useStore((s) => s.ui.recent)
  const [items, setItems] = useState<RecentConversation[]>()
  useEffect(() => {
    if (open) window.tz.recentConversations().then(setItems)
    else setItems(undefined)
  }, [open])
  if (!open) return null
  const home = (p: string) => p.replace(/^\/(Users|home)\/[^/]+/, '~')
  const rows: Row[] = (items ?? []).map((c) => ({
    key: c.id,
    text: c.prompt,
    hint: `${home(c.cwd).split(/[\\/]/).slice(-2).join('/')} · ${ago(c.updatedAt)}`,
    run: () => A.openConversation(c.id, c.cwd),
  }))
  return <Picker placeholder="Find a Claude conversation" rows={rows} onClose={() => store().setUI({ recent: false })} empty={items ? 'No conversations yet' : 'Loading…'} />
}

export function SettingsDialog() {
  const open = useStore((s) => s.ui.settings)
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const [args, setArgs] = useState(settings.claudeArgs)
  useEffect(() => setArgs(settings.claudeArgs), [open, settings.claudeArgs])
  if (!open) return null
  const close = () => {
    if (args !== settings.claudeArgs) setSettings({ claudeArgs: args })
    store().setUI({ settings: false })
  }
  return (
    <Scrim onClose={close}>
      <div className="dialog">
        <div className="dialog-body">
          <h2>Settings</h2>
          <div className="row">
            <div className="l"><b>Appearance</b></div>
            <div className="seg">
              {(['system', 'light', 'dark'] as const).map((t) => (
                <button key={t} className={settings.theme === t ? 'on' : ''} onClick={() => setSettings({ theme: t })}>
                  {t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="row">
            <div className="l"><b>Terminal font size</b><span>Also {key('font-up')} and {key('font-down')}</span></div>
            <div className="seg">
              <button onClick={() => setSettings({ fontSize: Math.max(9, settings.fontSize - 1) })}>−</button>
              <button className="on">{settings.fontSize}</button>
              <button onClick={() => setSettings({ fontSize: Math.min(24, settings.fontSize + 1) })}>+</button>
            </div>
          </div>
          <div className="row">
            <div className="l"><b>Notifications</b><span>When an agent needs you or finishes while you're elsewhere</span></div>
            <div className="seg">
              <button className={settings.notify ? 'on' : ''} onClick={() => setSettings({ notify: true })}>On</button>
              <button className={!settings.notify ? 'on' : ''} onClick={() => setSettings({ notify: false })}>Off</button>
            </div>
          </div>
          <div className="row" style={{ display: 'block' }}>
            <div className="l" style={{ marginBottom: 8 }}><b>Claude arguments</b><span>Added every time a session starts Claude Code, e.g. <code>--model opus</code></span></div>
            <input className="field" value={args} placeholder="--model opus" onChange={(e) => setArgs(e.target.value)} style={{ fontFamily: 'var(--mono)' }} />
          </div>
        </div>
        <div className="dialog-actions">
          <button className="pill primary" onClick={close}>Done</button>
        </div>
      </div>
    </Scrim>
  )
}

export function Inbox() {
  const open = useStore((s) => s.ui.inbox)
  const notes = useStore((s) => s.notes)
  const sessions = useStore((s) => s.ws.sessions)
  if (!open) return null
  const close = () => store().setUI({ inbox: false })
  const live = new Set(sessions.map((s) => s.id))
  const list = [...notes].reverse().filter((n) => live.has(n.sessionId))
  return (
    <Scrim onClose={close}>
      <div className="dialog inbox">
        <div className="head">
          <b>Notifications</b>
          <span className="kbd">{key('jump-unread')} latest unread</span>
          {list.some((n) => !n.read) && <button className="pill small" onClick={() => A.markAllRead()}>Mark All Read</button>}
        </div>
        <div className="items">
          {list.map((n) => (
            <div key={n.id} className={`note-item ${n.read ? 'read' : ''}`} onClick={() => (close(), A.openNote(n))}>
              <span className={`dot ${n.read ? '' : n.kind === 'blocked' ? 'blocked' : n.kind === 'done' ? 'done' : 'working'}`} style={n.read || n.kind !== 'notice' ? undefined : { animation: 'none' }} />
              <div className="body">
                <div className="t"><span>{n.title}</span><span className="when">{ago(n.at)}</span></div>
                {n.body && <div className="b">{n.body}</div>}
              </div>
            </div>
          ))}
          {!list.length && <div className="muted">Nothing yet. Agents that finish, need you or send a notification show up here.</div>}
        </div>
      </div>
    </Scrim>
  )
}
