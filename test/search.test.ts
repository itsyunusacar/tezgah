import { describe, expect, it, vi } from 'vitest'
vi.stubGlobal('window', { tz: {} })
const { fold, matches, search } = await import('../src/renderer/src/search')
import type { Session, Workspace } from '../src/shared/types'

const session = (id: string, projectId: string, title: string, extra: Partial<Session> = {}): Session => ({
  id, projectId, title, panes: [], layout: { type: 'pane', paneId: 'x' }, focusedPane: 'x', createdAt: id.charCodeAt(0), ...extra,
})

const ws: Workspace = {
  projects: [
    { id: 'p', name: 'Çalışma Alanı', path: '/Users/me/Projects/calisma', worktrees: false },
    { id: 'q', name: 'tezgah', path: '/Users/me/Projects/tezgah', worktrees: false },
    { id: 'r', name: 'empty', path: '/srv/empty', worktrees: false },
  ],
  sessions: [
    session('a', 'p', 'Giriş düzeltmesi'),
    session('b', 'q', 'fix login'),
    session('c', 'q', 'Docs'),
    session('d', 'q', 'old', { archived: true }),
    session('t', '', 'Terminal'),
  ],
}

const names = (query: string) =>
  search(ws, query, 'Terminals', '/Users/me').map((f) => `${f.project?.id ?? 'T'}:${f.sessions.map((s) => s.id).join('')}`)

describe('search', () => {
  it('folds case and Turkish letters', () => {
    expect(fold('Çalışma ŞİĞÖÜ é')).toBe('calisma sigou e')
    expect(matches('CALISMA alan', 'Çalışma Alanı')).toBe(true)
    expect(matches('giris', 'Giriş düzeltmesi')).toBe(true)
    expect(matches('ğiriş x', 'Giriş')).toBe(false)
  })

  it('shows a matching project with all its sessions, archived ones left out', () => {
    expect(names('tezgah')).toEqual(['q:bc'])
  })

  it('shows matching sessions under their project', () => {
    expect(names('login')).toEqual(['q:b'])
    expect(names('duzeltme')).toEqual(['p:a'])
    expect(names('tezgah docs')).toEqual(['q:c'])
  })

  it('finds a project by its folder, below home only', () => {
    expect(names('srv')).toEqual(['r:'])
    expect(names('projects/calisma')).toEqual(['p:a'])
    expect(names('users')).toEqual([])
  })

  it('finds terminals by name, and the Terminals group', () => {
    expect(names('terminal')).toEqual(['T:t'])
  })
})
