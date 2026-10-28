import { app, net } from 'electron'
import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
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
  try {
    fs.accessSync(path.dirname(target), fs.constants.W_OK)
    return target
  } catch {
    return undefined
  }
}

export const canInstall = (): boolean => installed() !== undefined

const folder = () => path.join(app.getPath('userData'), 'updates')

/** The downloaded version waiting for you to quit. */
let staged: { version: string; file: string } | undefined
let fetching: string | undefined

export const ready = (version: string): boolean => staged?.version === version

/** Leftovers of the last update, once it is installed and running. */
export function cleanUp(): void {
  fs.rmSync(folder(), { recursive: true, force: true })
}

/** Downloads the update in the background and keeps it for quitting time; calls onReady when it can be installed. */
export async function prepare(update: Update, onReady: () => void): Promise<void> {
  const asset = assetFor(update.assets, update.version, process.platform, process.arch, !!process.env.APPIMAGE)
  if (!asset || !canInstall() || ready(update.version) || fetching === update.version) return
  fetching = update.version
  try {
    cleanUp()
    fs.mkdirSync(folder(), { recursive: true })
    const file = path.join(folder(), asset.name)
    const res = await net.fetch(asset.browser_download_url, { headers: { 'User-Agent': `Tezgah/${app.getVersion()}` } })
    if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status}`)
    await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(file))
    if (fs.statSync(file).size !== asset.size) throw new Error('Incomplete download')
    let use = file
    if (process.platform === 'darwin') {
      await new Promise<void>((resolve, reject) => execFile('ditto', ['-x', '-k', file, folder()], (err) => (err ? reject(err) : resolve())))
      use = path.join(folder(), 'Tezgah.app')
      if (!fs.existsSync(path.join(use, 'Contents/MacOS/Tezgah'))) throw new Error('No app in the download')
    }
    if (process.platform === 'linux') fs.chmodSync(file, 0o755)
    staged = { version: update.version, file: use }
    onReady()
  } catch {
    // Next check tries again; the sidebar still offers the release page.
    cleanUp()
  } finally {
    fetching = undefined
  }
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
  const run = (command: string, args: string[]) => spawn(command, args, { detached: true, stdio: 'ignore' }).unref()
  if (process.platform === 'win32') return run(file, ['/S', '--updated', ...(relaunch ? ['--force-run'] : [])])
  const wait = `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.5; done`
  const swap =
    process.platform === 'darwin'
      ? 'rm -rf "$1.old" && mv "$1" "$1.old" || exit 1; if ditto "$2" "$1"; then rm -rf "$1.old"; xattr -cr "$1"; else rm -rf "$1"; mv "$1.old" "$1"; fi'
      : 'mv -f "$2" "$1"'
  const open = !relaunch ? '' : process.platform === 'darwin' ? 'open "$1"' : '"$1" >/dev/null 2>&1 &'
  run('/bin/sh', ['-c', [wait, swap, open].join('\n'), 'sh', target, file])
}
