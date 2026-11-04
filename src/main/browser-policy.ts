import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// What a page in a browser pane may do: which permissions it gets and which local files it may load.

/** Harmless for any page. */
const ALWAYS = new Set(['fullscreen', 'clipboard-sanitized-write'])
/** Also for a local dev server (localhost on any port): camera and microphone, location, notifications,
 *  reading the clipboard, MIDI. Screen capture stays refused. */
const LOCAL = new Set(['media', 'geolocation', 'notifications', 'clipboard-read', 'midi'])

/** http(s)://localhost, 127.0.0.1 or [::1], any port. */
export function isLocalOrigin(origin: string): boolean {
  try {
    const u = new URL(origin)
    return (u.protocol === 'http:' || u.protocol === 'https:') && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
  } catch {
    return false
  }
}

export const permitted = (permission: string, origin: string): boolean =>
  ALWAYS.has(permission) || (LOCAL.has(permission) && isLocalOrigin(origin))

/** A path with symlinks followed when it exists, so a link inside the folder can't point out of it. */
const real = (p: string) => {
  try {
    return fs.realpathSync(p)
  } catch {
    return p
  }
}

/**
 * May a local page load this file? Only from its own folder and below (its CSS, images, scripts), so a
 * page in a repository can't read ~/.aws/credentials. Nothing for pages that aren't local.
 */
export function localFileAllowed(pageUrl: string, fileUrl: string): boolean {
  try {
    if (!pageUrl.startsWith('file:')) return false
    const dir = real(path.dirname(fileURLToPath(pageUrl)))
    const target = real(path.resolve(fileURLToPath(fileUrl)))
    const prefix = dir.endsWith(path.sep) ? dir : dir + path.sep
    const head = target.slice(0, prefix.length)
    return process.platform === 'win32' ? head.toLowerCase() === prefix.toLowerCase() : head === prefix
  } catch {
    // Encoded slashes, a remote host: not a plain local path.
    return false
  }
}
