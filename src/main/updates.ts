import { app, net } from 'electron'
import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

// Is there a newer Tezgah? One unauthenticated request to GitHub's releases API at launch and every
// six hours (Settings can turn it off). Where this copy can replace itself (the macOS app, the Windows
// installer, an AppImage, in a folder you can write to), the new version is downloaded in the
// background and put in place when you quit; otherwise the sidebar offers the release page.

export interface Asset {
  name: string
  browser_download_url: string
  size: number
}

export interface Update {
  version: string
  url: string
  assets: Asset[]
}

/** Compares "1.0.0-alpha.2" style versions; prereleases sort before their release. */
export function newer(candidate: string, current: string): boolean {
  const parse = (v: string) => {
    const [core, pre = ''] = v.replace(/^v/, '').split('-')
    return { nums: core.split('.').map((n) => Number(n) || 0), pre }
  }
  const a = parse(candidate)
  const b = parse(current)
  for (let i = 0; i < 3; i++) if ((a.nums[i] ?? 0) !== (b.nums[i] ?? 0)) return (a.nums[i] ?? 0) > (b.nums[i] ?? 0)
  if (a.pre === b.pre) return false
  if (!a.pre) return true
  if (!b.pre) return false
  // alpha.2 vs alpha.10: compare the parts, numbers as numbers.
  const pa = a.pre.split('.')
  const pb = b.pre.split('.')
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === pb[i]) continue
    if (pa[i] === undefined) return false
    if (pb[i] === undefined) return true
    const na = Number(pa[i])
    const nb = Number(pb[i])
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na > nb
    return pa[i] > pb[i]
  }
  return false
}

export async function check(): Promise<Update | null> {
  try {
    const res = await net.fetch('https://api.github.com/repos/itsyunusacar/tezgah/releases?per_page=5', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Tezgah/${app.getVersion()}` },
    })
    if (!res.ok) return null
    const releases = (await res.json()) as { tag_name: string; html_url: string; draft: boolean; prerelease: boolean; assets: Asset[] }[]
    // Someone on a prerelease hears about prereleases too; someone on a release only about releases.
    const onPre = app.getVersion().includes('-')
    const latest = releases.find((r) => !r.draft && (onPre || !r.prerelease))
    if (!latest || !newer(latest.tag_name, app.getVersion())) return null
    return { version: latest.tag_name.replace(/^v/, ''), url: latest.html_url, assets: latest.assets ?? [] }
  } catch {
    return null
  }
}

/** The release file a copy of Tezgah updates itself from, named as electron-builder.yml names it. */
export function assetFor(assets: Asset[], version: string, platform: string, arch: string, appImage: boolean): Asset | undefined {
  const name =
    platform === 'darwin' ? `Tezgah-${version}-${arch === 'arm64' ? 'arm64-' : ''}mac.zip`
    : platform === 'win32' ? `Tezgah-Setup-${version}-${arch}.exe`
    : platform === 'linux' && appImage ? `Tezgah-${version}-${arch === 'x64' ? 'x86_64' : arch}.AppImage`
    : undefined
  return assets.find((a) => a.name === name)
}

/** What an update replaces: the .app, the installed .exe or the AppImage; nothing for a dev build or a .deb. */
function installed(): string | undefined {
  if (!app.isPackaged) return undefined
  const exe = app.getPath('exe')
  const target =
    process.platform === 'darwin' ? path.resolve(exe, '../../..')
    : process.platform === 'win32' ? exe
    : process.env.APPIMAGE
  if (!target || (process.platform === 'darwin' && !target.endsWith('.app'))) return undefined
  return writable(path.dirname(target)) ? target : undefined
}

/** Can this user write in the folder? On Windows access() ignores ACLs (Program Files says yes), so a
 *  file is made and removed there. */
function writable(dir: string): boolean {
  if (process.platform !== 'win32') {
    try {
      fs.accessSync(dir, fs.constants.W_OK)
      return true
    } catch {
      return false
    }
  }
  if (probed?.dir !== dir) {
    const probe = path.join(dir, `.tezgah-write-${process.pid}`)
    let ok = false
    try {
      fs.writeFileSync(probe, '')
      ok = true
      fs.rmSync(probe, { force: true, maxRetries: 3 })
    } catch {
      // Not ours to write in (or the probe stays behind, harmlessly).
    }
    probed = { dir, ok }
  }
  return probed.ok
}
let probed: { dir: string; ok: boolean } | undefined

export const canInstall = (): boolean => installed() !== undefined

const folder = () => path.join(app.getPath('userData'), 'updates')

/** The downloaded version waiting for you to quit. */
let staged: { version: string; file: string } | undefined
/** The download under way, to stop it. */
let fetching: AbortController | undefined

export const ready = (version: string): boolean => staged?.version === version

/** Leftovers of the last update, once it is installed and running. Never throws: on Windows a file still
 *  held open (an antivirus scanning the installer) must not stop Tezgah from starting. */
export function cleanUp(): void {
  try {
    fs.rmSync(folder(), { recursive: true, force: true, maxRetries: 3 })
  } catch (e) {
    console.error('tezgah: update leftovers:', (e as Error).message)
  }
}

/** Installing updates was turned off: stop a download and drop what's waiting for quitting time. */
export function unstage(): void {
  fetching?.abort()
  if (!staged) return
  staged = undefined
  cleanUp()
}

/** A download gives up when nothing arrives for a minute, or after half an hour in all. */
const STALL = 60_000
const LIMIT = 30 * 60_000

/**
 * Downloads the update in the background and keeps it for quitting time. True once it can be installed;
 * false while it can't (its file isn't uploaded yet, the download failed or is still going).
 */
export async function prepare(update: Update): Promise<boolean> {
  if (ready(update.version)) return true
  const asset = assetFor(update.assets, update.version, process.platform, process.arch, !!process.env.APPIMAGE)
  if (!asset || !canInstall() || fetching) return false
  const abort = new AbortController()
  fetching = abort
  let stall: NodeJS.Timeout | undefined
  const alive = () => {
    clearTimeout(stall)
    stall = setTimeout(() => abort.abort(new Error('Download stalled')), STALL)
  }
  try {
    // A newer release replaces the one waiting.
    staged = undefined
    cleanUp()
    fs.mkdirSync(folder(), { recursive: true })
    const file = path.join(folder(), asset.name)
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(LIMIT)])
    alive()
    const res = await net.fetch(asset.browser_download_url, { headers: { 'User-Agent': `Tezgah/${app.getVersion()}` }, signal })
    if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status}`)
    const progress = new Transform({
      transform(chunk, _enc, done) {
        alive()
        done(null, chunk)
      },
    })
    await pipeline(Readable.fromWeb(res.body as never), progress, fs.createWriteStream(file), { signal })
    if (fs.statSync(file).size !== asset.size) throw new Error('Incomplete download')
    let use = file
    if (process.platform === 'darwin') {
      await new Promise<void>((resolve, reject) => execFile('ditto', ['-x', '-k', file, folder()], (err) => (err ? reject(err) : resolve())))
      use = path.join(folder(), 'Tezgah.app')
      if (!fs.existsSync(path.join(use, 'Contents/MacOS/Tezgah'))) throw new Error('No app in the download')
    }
    if (process.platform === 'linux') fs.chmodSync(file, 0o755)
    if (abort.signal.aborted) throw new Error('Stopped')
    staged = { version: update.version, file: use }
    return true
  } catch {
    // Next check tries again; the sidebar still offers the release page.
    cleanUp()
    return false
  } finally {
    clearTimeout(stall)
    fetching = undefined
  }
}

/**
 * How the downloaded app replaces the installed one ("$1"; the download is "$2") once Tezgah has quit.
 * macOS: copied next to it first, then two renames, and the old one is put back if the second fails.
 * Linux: copied next to the AppImage (the download may be on another disk), then renamed over it.
 */
export function swapScript(platform: string): string {
  return platform === 'darwin'
    ? [
        'if [ ! -e "$1" ] && [ -e "$1.old" ]; then mv "$1.old" "$1"; fi',
        'rm -rf "$1.new" "$1.old"',
        'if ditto "$2" "$1.new"; then',
        '  xattr -cr "$1.new" 2>/dev/null',
        '  if mv "$1" "$1.old"; then',
        '    if mv "$1.new" "$1"; then rm -rf "$1.old"; else mv "$1.old" "$1"; fi',
        '  fi',
        'fi',
        'rm -rf "$1.new"',
      ].join('\n')
    : 'rm -f "$1.new"; cp "$2" "$1.new" && chmod 755 "$1.new" && mv -f "$1.new" "$1"; rm -f "$1.new"'
}

/**
 * Puts the downloaded version in place once Tezgah has quit, then opens it if asked. On macOS and Linux
 * a detached shell waits for this process to end and swaps the app (keeping the old one until the copy
 * succeeds); on Windows the installer does it, silently.
 */
export function installOnQuit(relaunch: boolean): void {
  const target = installed()
  if (!staged || !target) return
  const { file } = staged
  staged = undefined
  const run = (command: string, args: string[]) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    // Spawning fails asynchronously (a missing file, an antivirus); quitting goes on regardless.
    child.on('error', (e) => console.error('tezgah: installing the update:', e.message))
    child.unref()
  }
  if (process.platform === 'win32') return run(file, ['/S', '--updated', ...(relaunch ? ['--force-run'] : [])])
  const wait = `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.5; done`
  // Opens whichever copy is in place: the new one, or the old one if the swap failed.
  const open = !relaunch ? '' : process.platform === 'darwin' ? 'open "$1"' : '"$1" >/dev/null 2>&1 &'
  run('/bin/sh', ['-c', [wait, swapScript(process.platform), open].join('\n'), 'sh', target, file])
}
