import type { Project, Session, Workspace } from '../../shared/types'
import { TERMINALS, sessionsOf } from './store'

// Finding a project or session by typing part of its name: the sidebar's search field and the quick switcher.

const letters: Record<string, string> = { ı: 'i', İ: 'i', ş: 's', Ş: 's', ç: 'c', Ç: 'c', ğ: 'g', Ğ: 'g', ö: 'o', Ö: 'o', ü: 'u', Ü: 'u' }

/** Text as search compares it: lower case, Turkish letters and other accents dropped ("Çalışma" → "calisma"). */
export function fold(text: string): string {
  return text
    .replace(/[ıİşŞçÇğĞöÖüÜ]/g, (c) => letters[c])
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
}

/** Whether every word of the query is in the text, in any order. */
export function matches(query: string, ...text: (string | undefined)[]): boolean {
  const hay = fold(text.filter(Boolean).join(' '))
  return fold(query).split(/\s+/).filter(Boolean).every((w) => hay.includes(w))
}

export interface Found {
  /** A project, or undefined for Terminals. */
  project?: Project
  sessions: Session[]
}

/** The sidebar while searching: a group that matches by name or folder with all its sessions, otherwise
 *  only its sessions that match (with the group's name, so "tezgah fix" finds "fix" in tezgah). */
export function search(ws: Workspace, query: string, terminalsName: string, home = ''): Found[] {
  // Folders under home as "~/…", so the home folder's own name doesn't match every project.
  const short = (path: string) => (home && path.startsWith(home) ? '~' + path.slice(home.length) : path)
  const groups: { project?: Project; name: string; path?: string; id: string }[] = [
    { name: terminalsName, id: TERMINALS },
    ...ws.projects.map((p) => ({ project: p, name: p.name, path: short(p.path), id: p.id })),
  ]
  const out: Found[] = []
  for (const g of groups) {
    const all = sessionsOf(ws, g.id)
    if (g.id === TERMINALS && !all.length) continue
    const sessions = matches(query, g.name, g.path) ? all : all.filter((s) => matches(query, g.name, s.title, s.worktree?.branch))
    if (sessions.length || (g.project && matches(query, g.name, g.path))) out.push({ project: g.project, sessions })
  }
  return out
}
