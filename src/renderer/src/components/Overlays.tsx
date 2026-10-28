import { t } from '../../../shared/i18n'
import { useEffect, useMemo, useRef, useState } from 'react'
import { usageProviders, type CustomCommand, type RecentConversation, type TerminalLook, type TranscriptEntry } from '../../../shared/types'
import * as A from '../actions'
import { sessionStatus, statusLine, store, useStore } from '../store'
import { isMac } from '../terminals'
import { Search } from './Icons'
import { label, type Command } from '../../../shared/shortcuts'

export type MenuItem = { label: string; hint?: string; danger?: boolean; disabled?: boolean; run: () => void } | 'divider' | { header: string }

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
    <div className="menu" style={{ left: Math.max(8, Math.min(x, window.innerWidth - 260)), top: Math.max(8, Math.min(y, window.innerHeight - items.length * 30 - 12)) }} onMouseDown={(e) => e.stopPropagation()}>
      {items.map((it, i) =>
        it === 'divider' ? (
          <hr key={i} />
        ) : 'header' in it ? (
          <div key={i} className="menu-header">{it.header}</div>
        ) : (
          <button key={i} className={it.danger ? 'danger' : ''} disabled={it.disabled} onClick={() => (onClose(), it.run())}>
            <span>{it.label}</span>
            {it.hint && <span className="hint">{it.hint}</span>}
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
          <button className="pill" onClick={close}>{t('Cancel')}</button>
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
          <button className="pill" onClick={close}>{t('Cancel')}</button>
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
  const commands = useStore((s) => s.settings.commands)
  if (!open) return null
  const rows: Row[] = [
    ...commands.map((c) => ({ key: 'cmd-' + c.name, text: c.name, hint: c.command, run: () => A.runCustomCommand(c.name) })),
    ...A.orderedSessions().map((s) => ({
      key: s.id,
      text: s.title,
      hint: [A.project(s.projectId)?.name, statusLine(s, panes) || (sessionStatus(s, panes) === 'exited' ? 'Stopped' : '')].filter(Boolean).join(' · '),
      run: () => A.select(s.id),
    })),
    ...ws.sessions
      .filter((s) => s.archived)
      .map((s) => ({ key: s.id, text: s.title, hint: [A.project(s.projectId)?.name, t('Archived')].filter(Boolean).join(' · '), run: () => A.restoreSession(s.id) })),
    ...ws.projects.map((p) => ({ key: 'new-' + p.id, text: t('New session in {name}', { name: p.name }), hint: key('new-claude'), run: () => A.newSession(p.id, 'claude') })),
    { key: 'open', text: t('Open folder…'), hint: key('open-folder'), run: () => A.openFolder() },
    { key: 'recent', text: t('Recent conversations…'), hint: key('recent'), run: () => store().setUI({ recent: true }) },
    { key: 'wt', text: t('New session in a worktree…'), hint: key('new-worktree'), run: () => A.newWorktreeSession() },
    { key: 'browser', text: t('Open browser'), hint: key('browser'), run: () => A.openBrowserHere() },
    { key: 'inbox', text: t('Notifications'), hint: key('inbox'), run: () => store().setUI({ inbox: true }) },
    { key: 'find', text: t('Find in terminal'), hint: key('find'), run: () => A.selected() && store().setUI({ find: A.selected()!.focusedPane }) },
    { key: 'ssh', text: t('New SSH session…'), run: () => A.newSshSession() },
    { key: 'settings', text: t('Settings'), hint: key('settings'), run: () => store().setUI({ settings: true }) },
  ]
  return <Picker placeholder={t('Go to a session or run a command')} rows={rows} onClose={() => store().setUI({ palette: false })} empty={t('No match')} />
}

export function ago(at: number): string {
  const m = Math.round((Date.now() - at) / 60000)
  if (m < 1) return t('now')
  if (m < 60) return t('{n}m ago', { n: m })
  if (m < 1440) return t('{n}h ago', { n: Math.round(m / 60) })
  return t('{n}d ago', { n: Math.round(m / 1440) })
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
  return <Picker placeholder={t('Find a Claude conversation')} rows={rows} onClose={() => store().setUI({ recent: false })} empty={items ? t('No conversations yet') : t('Loading…')} />
}

const formatCommands = (list: CustomCommand[]) => list.map((c) => `${c.name}: ${c.command}`).join('\n')

export function parseCommands(text: string): CustomCommand[] {
  return text
    .split('\n')
    .map((line) => {
      const i = line.indexOf(':')
      return i > 0 ? { name: line.slice(0, i).trim(), command: line.slice(i + 1).trim() } : undefined
    })
    .filter((c): c is CustomCommand => !!c && !!c.name && !!c.command)
}

export function SettingsDialog() {
  const open = useStore((s) => s.ui.settings)
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const usage = useStore((s) => s.usage)
  const [args, setArgs] = useState(settings.claudeArgs)
  const [commands, setCommands] = useState(formatCommands(settings.commands))
  useEffect(() => setArgs(settings.claudeArgs), [open, settings.claudeArgs])
  useEffect(() => setCommands(formatCommands(settings.commands)), [open, settings.commands])
  const [ghostty, setGhostty] = useState<TerminalLook | null | undefined>()
  useEffect(() => {
    if (open) window.tz.ghosttyLook().then(setGhostty)
  }, [open])
  if (!open) return null
  const close = () => {
    if (args !== settings.claudeArgs) setSettings({ claudeArgs: args })
    if (commands !== formatCommands(settings.commands)) setSettings({ commands: parseCommands(commands) })
    store().setUI({ settings: false })
  }
  return (
    <Scrim onClose={close}>
      <div className="dialog">
        <div className="dialog-body">
          <h2>{t('Settings')}</h2>
          <div className="row">
            <div className="l"><b>{t('Appearance')}</b></div>
            <div className="seg">
              {(['system', 'light', 'dark'] as const).map((theme) => (
                <button key={theme} className={settings.theme === theme ? 'on' : ''} onClick={() => setSettings({ theme })}>
                  {t({ system: 'System', light: 'Light', dark: 'Dark' }[theme])}
                </button>
              ))}
            </div>
          </div>
          <div className="row">
            <div className="l"><b>{t('Language')}</b></div>
            <div className="seg">
              {(['system', 'tr', 'en'] as const).map((lang) => (
                <button key={lang} className={settings.language === lang ? 'on' : ''} onClick={() => setSettings({ language: lang })}>
                  {lang === 'system' ? t('System') : lang === 'tr' ? 'Türkçe' : 'English'}
                </button>
              ))}
            </div>
          </div>
          <div className="row">
            <div className="l"><b>{t('Terminal font size')}</b><span>{t('Also {up} and {down}', { up: key('font-up'), down: key('font-down') })}</span></div>
            <div className="seg">
              <button onClick={() => setSettings({ fontSize: Math.max(9, settings.fontSize - 1) })}>−</button>
              <button className="on">{settings.fontSize}</button>
              <button onClick={() => setSettings({ fontSize: Math.min(24, settings.fontSize + 1) })}>+</button>
            </div>
          </div>
          {(ghostty || settings.terminalLook === 'ghostty') && (
          <div className="row">
              <div className="l"><b>{t('Terminal look')}</b><span>{ghostty ? t('Use the font and colors from your Ghostty config') : t('No Ghostty config found')}</span></div>
              <div className="seg">
                <button className={settings.terminalLook !== 'ghostty' ? 'on' : ''} onClick={() => setSettings({ terminalLook: 'tezgah' })}>Tezgah</button>
                <button
                  className={settings.terminalLook === 'ghostty' ? 'on' : ''}
                  disabled={ghostty === null}
                  onClick={() => setSettings({ terminalLook: 'ghostty', ...(ghostty?.fontSize ? { fontSize: ghostty.fontSize } : {}) })}
                >
                  Ghostty
                </button>
              </div>
            </div>
          )}
          <div className="row">
            <div className="l">
              <b>{t('Plan limits in the sidebar')}</b>
              <span>{t('Gemini and Grok keep their limits on their servers only, so Tezgah can\'t show them.')}</span>
            </div>
            <div className="seg">
              {usageProviders.filter((p) => !p.unavailable).map((p) => {
                const on = !settings.hiddenUsage.includes(p.id)
                const has = usage.some((u) => u.id === p.id)
                return (
                  <button
                    key={p.id}
                    className={on ? 'on' : ''}
                    title={has ? undefined : p.id === 'codex' ? t('Shows while Codex is signed in or was used this week') : t('No {name} limits found right now', { name: p.name })}
                    onClick={() => setSettings({ hiddenUsage: on ? [...settings.hiddenUsage, p.id] : settings.hiddenUsage.filter((x) => x !== p.id) })}
                  >
                    {p.name}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="row">
            <div className="l"><b>{t('Check for updates')}</b><span>{t('Looks for a newer Tezgah on GitHub at launch and every six hours. Nothing is installed by itself.')}</span></div>
            <div className="seg">
              <button className={settings.checkUpdates ? 'on' : ''} onClick={() => setSettings({ checkUpdates: true })}>{t('On')}</button>
              <button className={!settings.checkUpdates ? 'on' : ''} onClick={() => setSettings({ checkUpdates: false })}>{t('Off')}</button>
            </div>
          </div>
          <div className="row">
            <div className="l"><b>{t('Notifications')}</b><span>{t('When an agent needs you or finishes while you\'re elsewhere')}</span></div>
            <div className="seg">
              <button className={settings.notify ? 'on' : ''} onClick={() => setSettings({ notify: true })}>{t('On')}</button>
              <button className={!settings.notify ? 'on' : ''} onClick={() => setSettings({ notify: false })}>{t('Off')}</button>
            </div>
          </div>
          <div className="row">
            <div className="l">
              <b>{t('Browser and pane tools for Claude')}</b>
              <span>{t('Claude sessions can open, read and click through pages in the browser pane, and read other panes. Other agents: see `tezgah help`.')}</span>
            </div>
            <div className="seg">
              <button className={settings.agentTools ? 'on' : ''} onClick={() => setSettings({ agentTools: true })}>{t('On')}</button>
              <button className={!settings.agentTools ? 'on' : ''} onClick={() => setSettings({ agentTools: false })}>{t('Off')}</button>
            </div>
          </div>
          <div className="row" style={{ display: 'block' }}>
            <div className="l" style={{ marginBottom: 8 }}><b>{t('Claude arguments')}</b><span>{t('Added every time a session starts Claude Code, e.g. --model opus')}</span></div>
            <input className="field" value={args} placeholder="--model opus" onChange={(e) => setArgs(e.target.value)} style={{ fontFamily: 'var(--mono)' }} />
          </div>
          <div className="row" style={{ display: 'block' }}>
            <div className="l" style={{ marginBottom: 8 }}>
              <b>{t('Commands')}</b>
              <span>{t('One per line as “Name: command”. Each runs in a new pane, from the + menu, the quick switcher or `tezgah run <name>`. Other agents work too, e.g. “Codex: codex”.')}</span>
            </div>
            <textarea className="field area" value={commands} placeholder={'Dev server: npm run dev\nTests: npm test -- --watch\nCodex: codex'} onChange={(e) => setCommands(e.target.value)} rows={4} spellCheck={false} />
          </div>
        </div>
        <div className="dialog-actions">
          <button className="pill primary" onClick={close}>{t('Done')}</button>
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
          <b>{t('Notifications')}</b>
          <span className="kbd">{key('jump-unread')} latest unread</span>
          {list.some((n) => !n.read) && <button className="pill small" onClick={() => A.markAllRead()}>{t('Mark All Read')}</button>}
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
          {!list.length && <div className="muted">{t('Nothing yet. Agents that finish, need you or send a notification show up here.')}</div>}
        </div>
      </div>
    </Scrim>
  )
}

/** A subagent's transcript, following along while it works. */
export function AgentDialog() {
  const target = useStore((s) => s.ui.agent)
  const agent = useStore((s) => (target ? Object.values(s.agents).flat().find((a) => a.id === target.id && a.claudeId === target.claudeId) : undefined))
  const [entries, setEntries] = useState<TranscriptEntry[]>([])
  const list = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    if (!target) return setEntries([])
    let alive = true
    const load = () => window.tz.agentTranscript(target.claudeId, target.id).then((e) => alive && setEntries(e))
    load()
    const t = setInterval(load, 1500)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [target])
  useEffect(() => {
    const el = list.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [entries])

  if (!target) return null
  const close = () => store().setUI({ agent: undefined })
  return (
    <Scrim onClose={close}>
      <div className="dialog transcript">
        <div className="head">
          <span className={`dot ${agent?.running ? 'working' : 'done'}`} style={{ marginTop: 0 }} />
          <b>{agent?.description ?? target.id}</b>
          <span className="kbd">{agent ? `${agent.type} · ${agent.toolUses} tools` : ''}</span>
        </div>
        <div className="steps" ref={list} onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}>
          {entries.map((e, i) => (
            <div key={i} className={`step ${e.kind}`}>{e.text}</div>
          ))}
          {!entries.length && <div className="muted">{t('Nothing written yet.')}</div>}
        </div>
      </div>
    </Scrim>
  )
}
