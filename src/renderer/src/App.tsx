import { resolveLanguage, setLanguage, t } from '../../shared/i18n'
import { useEffect, useRef } from 'react'
import * as A from './actions'
import { rootRecord, sessionCwd, sessionStatus, statusLine, store, useStore } from './store'
import * as terms from './terminals'
import { startControl } from './control'
import { start as startActivity } from './activity'
import { Sidebar } from './components/Sidebar'
import { SessionView } from './components/SessionView'
import { AgentDialog, ConfirmDialog, Inbox, Palette, PromptDialog, RecentDialog, SettingsDialog, Toast } from './components/Overlays'
import { Mark } from './components/Icons'
import { BrowserLayer } from './components/Browser'
import { label, type Command } from '../../shared/shortcuts'

const key = (c: Command) => label(c, terms.isMac)

export function App() {
  const ready = useStore((s) => s.ready)
  const sidebar = useStore((s) => s.ui.sidebar)
  const selectedId = useStore((s) => s.ws.selectedSession)
  const session = useStore((s) => s.ws.sessions.find((x) => x.id === s.ws.selectedSession))
  const theme = useStore((s) => s.settings.theme)
  const fontSize = useStore((s) => s.settings.fontSize)
  // The interface language; set before children render so every t() in this pass uses it.
  const languageSetting = useStore((s) => s.settings.language)
  setLanguage(resolveLanguage(languageSetting, navigator.language))

  useTheme(theme)
  const terminalLook = useStore((s) => s.settings.terminalLook)
  useEffect(() => {
    if (terminalLook !== 'ghostty') return terms.setLook(null)
    window.tz.ghosttyLook().then((l) => terms.setLook(l))
  }, [terminalLook])
  useEffect(() => terms.applyFontSize(fontSize), [fontSize])
  useMenu()
  useWatchers()

  useEffect(() => {
    if (selectedId) A.select(selectedId)
  }, [selectedId])

  useEffect(() => startControl(), [])
  useEffect(() => startActivity(), [])

  // Shell screens survive a relaunch.
  useEffect(() => {
    window.addEventListener('beforeunload', terms.saveScrollback)
    const t = setInterval(terms.saveScrollback, 60_000)
    return () => {
      window.removeEventListener('beforeunload', terms.saveScrollback)
      clearInterval(t)
    }
  }, [])

  useEffect(() =>
    terms.onNotice((paneId, n) => {
      const s = A.sessionOfPane(paneId)
      if (s) A.addNote(s.id, paneId, 'notice', n.title || s.title, n.body || n.title || '')
    }), [])

  if (!ready) return null
  const platform = terms.isMac ? 'mac' : window.tz.platform === 'win32' ? 'win' : 'linux'
  return (
    <div className={`app ${platform}`}>
      {sidebar && <Sidebar />}
      {session ? <SessionView key={session.id} session={session} /> : <Empty />}
      <BrowserLayer />
      <Palette />
      <RecentDialog />
      <SettingsDialog />
      <Inbox />
      <AgentDialog />
      <PromptDialog />
      <ConfirmDialog />
      <Toast />
    </div>
  )
}

function Empty() {
  const hasProjects = useStore((s) => s.ws.projects.length > 0)
  return (
    <div className="main">
      <div className="header" />
      <div className="empty" style={{ position: 'relative' }}>
        <div className="grid-paper" style={{ position: 'absolute', inset: 0, opacity: 0.6 }} />
        <div style={{ position: 'relative' }}>
          <Mark size={56} />
          <h1>{t('Tezgah')}</h1>
          <p>{t('Your projects and AI agents, on one bench.')}</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button className="pill primary" onClick={() => A.openFolder()}>{t('Open a Folder')}</button>
            {hasProjects && <button className="pill" onClick={() => A.newSession(undefined, 'claude')}>{t('New Session')}</button>}
            <button className="pill" onClick={() => store().setUI({ recent: true })}>{t('Recent Conversations')}</button>
          </div>
          <div className="keys" style={{ display: 'inline-grid' }}>
            <span>{t('New Claude session')}</span><span className="kbd">{key('new-claude')}</span>
            <span>{t('New shell session')}</span><span className="kbd">{key('new-shell')}</span>
            <span>{t('Go to session')}</span><span className="kbd">{key('palette')}</span>
            <span>{t('Next one that needs you')}</span><span className="kbd">{key('next-waiting')}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function useTheme(theme: 'system' | 'light' | 'dark') {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
      terms.applyTheme()
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])
}

function useMenu() {
  useEffect(() => {
    const off = window.tz.onMenu((action) => {
      const s = A.selected()
      const ui = store().ui
      if (action.startsWith('goto-')) {
        const list = A.orderedSessions()
        const target = list[Number(action.slice(5))]
        if (target) A.select(target.id)
        return
      }
      switch (action) {
        case 'new-claude': return void A.newSession(s?.projectId, 'claude')
        case 'new-shell': return void A.newSession(s?.projectId, 'shell')
        case 'new-worktree': return A.newWorktreeSession(s?.projectId)
        case 'open-folder': return void A.openFolder()
        case 'recent': return store().setUI({ recent: true })
        case 'settings': return store().setUI({ settings: true })
        case 'palette': return store().setUI({ palette: !ui.palette })
        case 'changes': return store().setUI({ changes: !ui.changes })
        case 'sidebar': return store().setUI({ sidebar: !ui.sidebar })
        case 'close-pane': return A.closePane()
        case 'close-session': return s && A.closeSession(s.id)
        case 'split-row': return void A.split('row')
        case 'split-column': return void A.split('column')
        case 'browser': return A.openBrowserHere()
        case 'next': return A.move(1)
        case 'prev': return A.move(-1)
        case 'next-waiting': return A.nextWaiting()
        case 'jump-unread': return A.jumpToUnread()
        case 'inbox': return store().setUI({ inbox: !ui.inbox })
        case 'find': return s && store().setUI({ find: ui.find === s.focusedPane ? undefined : s.focusedPane })
        case 'allow': return A.answer(s?.id, true)
        case 'deny': return A.answer(s?.id, false)
        case 'interrupt': return A.interrupt()
        case 'restart': return void A.restartPane()
        case 'clear': return s && terms.clear(s.focusedPane)
        case 'paste': {
          // Text fields (dialogs, notes) get the normal paste; terminals get files/images as paths.
          const el = document.activeElement
          const inField = el instanceof HTMLInputElement || (el instanceof HTMLTextAreaElement && !el.classList.contains('xterm-helper-textarea'))
          if (inField || !s) return window.tz.nativePaste()
          return void terms.pasteClipboard(s.focusedPane, (paths) => A.dropFiles(s.id, s.focusedPane, paths))
        }
        case 'font-up': return store().setSettings({ fontSize: Math.min(24, store().settings.fontSize + 1) })
        case 'font-down': return store().setSettings({ fontSize: Math.max(9, store().settings.fontSize - 1) })
        case 'font-reset': return store().setSettings({ fontSize: 13 })
      }
    })
    const onFocus = () => {
      const s = A.selected()
      if (s) A.seenPane(s.focusedPane)
    }
    window.addEventListener('focus', onFocus)
    const offFolder = window.tz.onOpenFolder((p) => A.openFolder(p))
    const offClick = window.tz.onNotificationClick((id) => A.select(id))
    return () => {
      window.removeEventListener('focus', onFocus)
      off()
      offFolder()
      offClick()
    }
  }, [])
}

/** Background work: subagents, usage limits, the dock badge and notifications. */
function useWatchers() {
  const panes = useStore((s) => s.panes)
  const sessions = useStore((s) => s.ws.sessions)
  const previous = useRef<Record<string, string | undefined>>({})
  const lastTray = useRef('')

  // Status changes → "unseen done" marks, notifications, badge.
  useEffect(() => {
    const { ws, unseen } = store()
    const nextUnseen = { ...unseen }
    let waiting = 0
    for (const s of ws.sessions) {
      const status = sessionStatus(s, panes)
      const before = previous.current[s.id]
      previous.current[s.id] = status
      if (status === 'blocked') waiting++
      if (status === before || before === undefined) continue
      const visible = document.hasFocus() && ws.selectedSession === s.id
      if (status === 'done' && !visible) nextUnseen[s.id] = true
      if (status === 'blocked' || status === 'done') {
        const pane = s.panes.find((p) => rootRecord(panes[p.id])?.state === status)
        A.addNote(s.id, pane?.id, status, s.title, status === 'blocked' ? statusLine(s, panes) || t('Needs you') : t('Finished'))
      }
    }
    if (Object.keys(nextUnseen).length !== Object.keys(unseen).length) useStore.setState({ unseen: nextUnseen })
    window.tz.setBadge(waiting)
    // The menu bar icon's list, most urgent first.
    const rank: Record<string, number> = { blocked: 0, error: 1, done: 2, working: 3 }
    const tray = {
      sessions: A.orderedSessions()
        .map((s) => ({
          id: s.id,
          title: s.title,
          project: A.project(s.projectId)?.name,
          status: sessionStatus(s, panes),
          line: statusLine(s, panes).slice(0, 80),
          unseen: !!nextUnseen[s.id],
        }))
        .sort((a, b) => (rank[a.status ?? ''] ?? 9) - (rank[b.status ?? ''] ?? 9)),
    }
    const json = JSON.stringify(tray)
    if (json !== lastTray.current) {
      lastTray.current = json
      window.tz.updateTray(tray)
    }
  }, [panes, sessions])

  // Subagents of sessions whose Claude is busy (and briefly after).
  useEffect(() => {
    const poll = async () => {
      const { ws, panes, agents } = store()
      const next: typeof agents = {}
      for (const s of ws.sessions) {
        const status = sessionStatus(s, panes)
        const active = status === 'working' || status === 'blocked' || (agents[s.id]?.length ?? 0) > 0
        if (!active) continue
        const ids = s.panes.filter((p) => p.claudeId).map((p) => p.claudeId!)
        const lists = await Promise.all(ids.map((id) => window.tz.subagents(id)))
        const list = lists.flat()
        if (list.length) next[s.id] = list
      }
      useStore.setState({ agents: next })
    }
    poll()
    const t = setInterval(poll, 2000)
    return () => clearInterval(t)
  }, [])

  // Branch, listening ports and pull request of every session.
  useEffect(() => {
    const load = async () => {
      const { ws } = store()
      const entries = await Promise.all(
        ws.sessions.map(async (s) => {
          const cwd = sessionCwd(s, A.project(s.projectId))
          return [s.id, await window.tz.sessionMeta(cwd, s.panes.map((p) => p.id))] as const
        }),
      )
      useStore.setState({ meta: Object.fromEntries(entries) })
    }
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [])

  // A newer Tezgah: at launch and every six hours, unless turned off.
  const checkUpdates = useStore((s) => s.settings.checkUpdates)
  useEffect(() => {
    if (!checkUpdates) return void useStore.setState({ update: null })
    const load = () => window.tz.checkUpdate().then((update) => useStore.setState({ update }))
    load()
    const timer = setInterval(load, 6 * 3_600_000)
    return () => clearInterval(timer)
  }, [checkUpdates])

  // Plan limits: Codex's from its logs every minute; Claude's are fetched every three (cached in main).
  useEffect(() => {
    const load = () => window.tz.usage().then((usage) => useStore.setState({ usage }))
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [])
}
