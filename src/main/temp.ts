import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Files Tezgah makes for agents to read (screenshots, pasted images) live in the temporary folder, which
// on Linux every user shares: they go in a folder of this user's own, and are cleaned up after a day.

/** Files older than this are removed when the next one is made. */
const AGE = 24 * 3_600_000

/** A folder only this user can use, made if it isn't there; false if someone else got there first. */
export function ownFolder(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    if (process.platform === 'win32') return true
    const st = fs.lstatSync(dir)
    return st.isDirectory() && st.uid === process.getuid?.() && (st.mode & 0o077) === 0
  } catch {
    return false
  }
}

/** A new file's path in `<temp>/<folder>-<uid>`, after removing the folder's day-old files. */
export function privateTempFile(folder: string, name: string): string {
  const dir = path.join(os.tmpdir(), `${folder}-${process.getuid?.() ?? 'user'}`)
  if (!ownFolder(dir)) throw new Error(`${dir} belongs to someone else; not saving there`)
  for (const f of fs.readdirSync(dir)) {
    try {
      const file = path.join(dir, f)
      if (Date.now() - fs.statSync(file).mtimeMs > AGE) fs.rmSync(file, { force: true })
    } catch {
      // Gone already, or held open.
    }
  }
  return path.join(dir, name)
}

/** Writes a file only this user can read. */
export const writePrivate = (file: string, data: Buffer): void => fs.writeFileSync(file, data, { mode: 0o600 })
