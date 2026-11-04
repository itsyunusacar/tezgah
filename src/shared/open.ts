// What Tezgah is asked to open from outside (ssh:// links, `-e` commands, Explorer), checked and quoted
// before any of it is typed into a shell.

/** A page a browser pane may show: the web, local files, data: and the blank page; no other schemes. */
export function browsable(url: string): boolean {
  try {
    const u = new URL(url)
    return ['http:', 'https:', 'file:', 'data:'].includes(u.protocol) || (u.protocol === 'about:' && u.pathname === 'blank')
  } catch {
    return false
  }
}

/** user@host or a Host from ~/.ssh/config: nothing a shell would read as more than one word. */
export const isSshHost = (s: string): boolean => /^[\w.@:-]+$/.test(s) && !s.startsWith('-')

/** What `ssh` gets typed with: a target, and `-p port` when there is one. */
export function isSshTarget(target: string): boolean {
  const m = target.match(/^(\S+)(?: -p (\d{1,5}))?$/)
  return !!m && isSshHost(m[1]) && (m[2] === undefined || (Number(m[2]) > 0 && Number(m[2]) < 65536))
}

/** ssh://user@host:port as ssh arguments ("user@host -p port"); undefined for anything else. */
export function sshFromUrl(url: string): string | undefined {
  try {
    const u = new URL(url)
    if (u.protocol !== 'ssh:') return undefined
    const host = u.hostname.replace(/^\[(.*)\]$/, '$1')
    const user = decodeURIComponent(u.username)
    if (!host || !isSshHost(host) || (user && (!isSshHost(user) || user.includes('@')))) return undefined
    const target = `${user ? user + '@' : ''}${host}${u.port ? ` -p ${u.port}` : ''}`
    return isSshTarget(target) ? target : undefined
  } catch {
    return undefined
  }
}

/** A word for sh, in single quotes unless it needs none. */
export const shQuote = (s: string): string => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`)

/** The command after `-e` / `-x`: one argument is a command line already; more are words, quoted so
 *  `-e sh -c "foo bar"` keeps "foo bar" together. */
export function commandFromArgs(args: string[], windows: boolean): string {
  if (args.length === 1 || windows) return args.join(' ')
  return args.map(shQuote).join(' ')
}

/** Explorer passes a drive root as `"C:\"`, which Windows reads as C: and an escaped quote. */
export const windowsArg = (a: string): string => (/^[a-z]:"$/i.test(a) ? `${a.slice(0, 2)}\\` : a)

/** A file:// URL as a local path (Linux file managers pass folders as %U); undefined for another host,
 *  an encoded slash or anything that isn't one. */
export function pathFromFileUrl(arg: string, windows = false): string | undefined {
  if (!/^file:/i.test(arg)) return undefined
  try {
    const u = new URL(arg)
    if ((u.hostname && u.hostname !== 'localhost') || /%(2f|5c|00)/i.test(u.pathname)) return undefined
    const p = decodeURIComponent(u.pathname)
    if (!windows) return p
    return /^\/[a-z]:/i.test(p) ? p.slice(1).replace(/\//g, '\\') : undefined
  } catch {
    return undefined
  }
}
