import fs from 'node:fs'
import path from 'node:path'

// Persistence: small JSON files in the user data folder, written atomically. A file that is there but
// can't be read (locked by another program, no permission) is never written over with what Tezgah fell
// back to, so an empty workspace can't replace the real one. `name.bak` keeps the copy from the start
// of the session.

/** Files that were there but couldn't be read at launch: 'backup' when the backup stood in for them
 *  (saved once the file can be read again, after it goes to .bak), 'blocked' when nothing did. */
const unreadable = new Map<string, 'backup' | 'blocked'>()
/** Files whose start-of-session copy is already in `.bak`. */
const backedUp = new Set<string>()

const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/** Runs a file operation, trying a few more times while Windows (an antivirus, the indexer) holds the file. */
export function retrying<T>(op: () => T, tries = 5): T {
  for (let i = 1; ; i++) {
    try {
      return op()
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (i >= tries || !(code === 'EPERM' || code === 'EBUSY' || code === 'EACCES')) throw e
      pause(25 * i)
    }
  }
}

type Read<T> = { value: T } | { missing: true } | { damaged: true } | { locked: true }

function read<T>(file: string, fallback: T): Read<T> {
  let text: string
  try {
    text = retrying(() => fs.readFileSync(file, 'utf8'))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { missing: true }
    console.error(`tezgah: can't read ${path.basename(file)}:`, (e as Error).message)
    return { locked: true }
  }
  try {
    return { value: { ...fallback, ...JSON.parse(text) } }
  } catch {
    console.error(`tezgah: ${path.basename(file)} is damaged`)
    return { damaged: true }
  }
}

export function readJson<T>(dir: string, name: string, fallback: T): T {
  const file = path.join(dir, name)
  const main = read(file, fallback)
  unreadable.delete(name)
  if ('value' in main) return main.value
  if ('damaged' in main) {
    // Kept aside for whoever wants to look; the next save replaces it, and leaves the backup as it is.
    try {
      fs.copyFileSync(file, `${file}.damaged`)
    } catch {
      // Best effort.
    }
    backedUp.add(name)
  }
  const backup = read(`${file}.bak`, fallback)
  if ('locked' in main) unreadable.set(name, 'value' in backup ? 'backup' : 'blocked')
  return 'value' in backup ? backup.value : fallback
}

/** Writes a file atomically; never throws (a failed save is logged and the next one tries again). */
export function writeJson(dir: string, name: string, value: unknown): boolean {
  const target = path.join(dir, name)
  const state = unreadable.get(name)
  if (state === 'blocked' || (state === 'backup' && !('value' in read(target, {})))) {
    console.error(`tezgah: not saving ${name}; it couldn't be read at launch`)
    return false
  }
  const tmp = `${target}.tmp`
  try {
    fs.mkdirSync(dir, { recursive: true })
    retrying(() => fs.writeFileSync(tmp, JSON.stringify(value, null, 2)))
    if (!backedUp.has(name) && fs.existsSync(target)) retrying(() => fs.copyFileSync(target, `${target}.bak`))
    backedUp.add(name)
    retrying(() => fs.renameSync(tmp, target))
    unreadable.delete(name)
    return true
  } catch (e) {
    console.error(`tezgah: can't save ${name}:`, (e as Error).message)
    return false
  }
}
