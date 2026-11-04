import { describe, expect, it, vi } from 'vitest'
vi.stubGlobal('window', { tz: {} })
const { agentPane, limitsFor, migrateHome, nextSelection, visibleSessions } = await import('../src/renderer/src/store')
import type { Session, Workspace } from '../src/shared/types'

const session = (id: string, projectId: string, createdAt: number, extra: Partial<Session> = {}): Session => ({
  id, projectId, title: id, panes: [], layout: { type: 'pane', paneId: 'x' }, focusedPane: 'x', createdAt, ...extra,
})

// Created in the order a, b, c, d, e; the sidebar shows project p (pinned c first) then q.
const ws = (selected: string): Workspace => ({
  projects: [{ id: 'p', name: 'p', path: '/p', worktrees: false }, { id: 'q', name: 'q', path: '/q', worktrees: false }],
  sessions: [
    session('a', 'p', 1),
    session('b', 'p', 2, { archived: true }),
    session('e', 'q', 3),
    session('c', 'p', 4, { pinned: true }),
    session('d', 'p', 5),
  ],
  selectedSession: selected,
})

describe('session order', () => {
  it('lists what the sidebar shows, top to bottom', () => {
    expect(visibleSessions(ws('a')).map((s) => s.id)).toEqual(['c', 'a', 'd', 'e'])
  })

  it('selects the session below a closed one, never an archived one', () => {
    expect(nextSelection(ws('a'), 'a')).toBe('d')
    expect(nextSelection(ws('c'), 'c')).toBe('a')
  })

  it('selects the one above at the end of the list, across projects', () => {
    expect(nextSelection(ws('e'), 'e')).toBe('d')
    expect(nextSelection(ws('d'), 'd')).toBe('e')
  })

  it('keeps the selection when another session closes', () => {
    expect(nextSelection(ws('a'), 'd')).toBe('a')
    expect(nextSelection(ws('a'), 'b')).toBe('a')
  })

  it('selects nothing when the last session closes', () => {
    const one: Workspace = { projects: ws('a').projects, sessions: [session('a', 'p', 1)], selectedSession: 'a' }
    expect(nextSelection(one, 'a')).toBeUndefined()
  })
})

describe('agent panes', () => {
  const rt = (app?: string, exited = false) => ({
    records: app ? [{ id: '', state: 'idle' as const, app }] : [], title: '', exited, activity: false, attention: false,
  })

  it('are Claude panes and panes where an agent reports', () => {
    expect(agentPane('claude', undefined)).toBe(true)
    expect(agentPane('shell', rt('codex'))).toBe(true)
  })

  it('are not plain shells or finished programs', () => {
    expect(agentPane('shell', rt())).toBe(false)
    expect(agentPane('shell', undefined)).toBe(false)
    expect(agentPane('claude', rt('claude', true))).toBe(false)
  })
})

describe('terminals', () => {
  it('come first in the sidebar', () => {
    const w = ws('a')
    w.sessions.push(session('t', '', 9))
    expect(visibleSessions(w).map((s) => s.id)).toEqual(['t', 'c', 'a', 'd', 'e'])
  })

  const pane = (kind: 'shell' | 'claude') => ({ id: kind, kind })
  const home = (sessions: Session[]): Workspace => ({ projects: [{ id: 'h', name: '~', path: '/Users/me', worktrees: false }, { id: 'p', name: 'p', path: '/p', worktrees: false }], sessions })

  it('take the shells of the old home-folder project, which goes once empty', () => {
    const w = migrateHome(home([session('s', 'h', 1, { panes: [pane('shell')] }), session('x', 'p', 2, { panes: [pane('shell')] })]), '/Users/me')
    expect(w.sessions.map((s) => `${s.id}:${s.projectId}`)).toEqual(['s:', 'x:p'])
    expect(w.projects.map((p) => p.id)).toEqual(['p'])
  })

  it('leave Claude sessions and worktrees in the home project', () => {
    const w = migrateHome(home([
      session('s', 'h', 1, { panes: [pane('shell')] }),
      session('c', 'h', 2, { panes: [pane('claude')] }),
      session('w', 'h', 3, { panes: [pane('shell')], worktree: { branch: 'b', path: '/w', base: 'main' } }),
    ]), '/Users/me')
    expect(w.sessions.map((s) => `${s.id}:${s.projectId}`)).toEqual(['s:', 'c:h', 'w:h'])
    expect(w.projects.map((p) => p.id)).toEqual(['h', 'p'])
  })

  it('leave a workspace without a home project alone', () => {
    const w = ws('a')
    expect(migrateHome(w, '/Users/me')).toBe(w)
  })
})

describe('limitsFor', () => {
  const rt = (app?: string, exited = false) => ({ records: app ? [{ id: '', state: 'working', app }] : [], exited }) as never
  const two = session('s', 'p', 1, {
    panes: [{ id: 'c', kind: 'claude' }, { id: 'x', kind: 'shell' }],
    focusedPane: 'x',
  })

  it("shows the focused pane's agent, else any pane's, else Claude", () => {
    expect(limitsFor(two, { x: rt('codex') })).toBe('codex')
    expect(limitsFor({ ...two, focusedPane: 'c' }, { x: rt('codex') })).toBe('claude')
    expect(limitsFor({ ...two, panes: [{ id: 'x', kind: 'shell' }] }, { x: rt() })).toBe('claude')
    expect(limitsFor({ ...two, panes: [{ id: 'x', kind: 'shell' }] }, { x: rt('codex', true) })).toBe('claude')
    expect(limitsFor(undefined, {})).toBe('claude')
  })
})
