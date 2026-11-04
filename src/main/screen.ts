import { BrowserWindow, desktopCapturer, shell, systemPreferences } from 'electron'
import { execFile } from 'node:child_process'
import type { ScreenAccess, ScreenSourceInfo } from '../shared/types'

// Screen panes: a live view of another window (Unity, a simulator, Chrome) or a whole display, so you can
// watch what an agent does there. The renderer captures with getUserMedia and a source id from here.
// macOS asks for Screen Recording once; until it's allowed, nothing is listed (listing would ask again).

/** Tests and screenshots: TEZGAH_FAKE_SCREENS=1 lists made-up windows that the renderer draws itself;
 *  "denied" acts as if macOS said no. */
const fake = () => process.env.TEZGAH_FAKE_SCREENS

export function access(): ScreenAccess {
  if (fake() === 'denied') return 'denied'
  if (fake() || process.platform !== 'darwin') return 'granted'
  return systemPreferences.getMediaAccessStatus('screen') as ScreenAccess
}

/** macOS window ids → the app that owns each, from the window server (no permission needed for owners). */
interface Owner { app: string; pid: number; bundle: string }
const owners = new Map<string, Owner>()

const WINDOWS_JXA = `ObjC.import('CoreGraphics'); ObjC.import('AppKit');
const list = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, 0))) || [];
const bundles = {};
JSON.stringify(list.filter((w) => w.kCGWindowLayer === 0).map((w) => {
  const pid = w.kCGWindowOwnerPID;
  if (!(pid in bundles)) { const a = $.NSRunningApplication.runningApplicationWithProcessIdentifier(pid); bundles[pid] = a.isNil() ? '' : ObjC.unwrap(a.bundleURL.path) || '' }
  return [w.kCGWindowNumber, w.kCGWindowOwnerName, pid, bundles[pid]];
}))`

function macOwners(): Promise<void> {
  return new Promise((resolve) =>
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', WINDOWS_JXA], { timeout: 5000 }, (err, out) => {
      if (!err) {
        try {
          for (const [id, app, pid, bundle] of JSON.parse(out) as [number, string, number, string][]) owners.set(String(id), { app, pid, bundle })
        } catch {
          // Unreadable: windows go by their titles alone.
        }
      }
      resolve()
    }),
  )
}

/** "window:1234:0" → "1234", the window server's number for it on macOS. */
const windowNumber = (id: string) => id.match(/^window:(\d+):/)?.[1]

/** Windows and displays to show, with small pictures for the picker; never Tezgah's own windows. Without
 *  permission only when you `ask` (a button press): on macOS that's what puts up the system's question. */
export async function sources(thumbnails: boolean, ask = false): Promise<ScreenSourceInfo[]> {
  if (fake()) return fake() === 'denied' ? [] : fakeSources()
  if (access() !== 'granted' && !ask) return []
  const size = thumbnails ? { width: 320, height: 200 } : { width: 0, height: 0 }
  const [list] = await Promise.all([
    desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: size, fetchWindowIcons: thumbnails }),
    process.platform === 'darwin' ? macOwners() : Promise.resolve(),
  ])
  const own = new Set(BrowserWindow.getAllWindows().map((w) => w.getMediaSourceId()))
  return list
    .filter((s) => !own.has(s.id) && s.name.trim() && owners.get(windowNumber(s.id) ?? '')?.pid !== process.pid)
    .map((s) => {
      const owner = owners.get(windowNumber(s.id) ?? '')
      return {
        id: s.id,
        kind: s.id.startsWith('screen:') ? 'screen' : 'window',
        name: s.name,
        app: owner?.app,
        thumbnail: thumbnails && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : undefined,
        icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.resize({ width: 32 }).toDataURL() : undefined,
        canShow: !!owner?.bundle,
      } satisfies ScreenSourceInfo
    })
}

/** Brings the app that owns a window to the front (macOS). */
export function showApp(id: string): boolean {
  const owner = owners.get(windowNumber(id) ?? '')
  if (!owner?.bundle) return false
  execFile('/usr/bin/open', ['-a', owner.bundle], () => undefined)
  return true
}

/** System Settings → Privacy & Security → Screen Recording. */
export function openSettings(): void {
  if (process.platform === 'darwin') shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
}

const svg = (fill: string, label: string) =>
  'data:image/svg+xml;base64,' +
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="${fill}"/><text x="160" y="108" font-family="sans-serif" font-size="22" fill="#fff" text-anchor="middle">${label}</text></svg>`).toString('base64')

function fakeSources(): ScreenSourceInfo[] {
  return [
    { id: 'fake:window:1', kind: 'window', name: 'SampleScene - Unity 6', app: 'Unity', thumbnail: svg('#2F5FD0', 'Unity'), canShow: false },
    { id: 'fake:window:2', kind: 'window', name: 'iPhone 17 Pro', app: 'Simulator', thumbnail: svg('#2E8B57', 'Simulator'), canShow: false },
    { id: 'fake:screen:1', kind: 'screen', name: 'Entire Screen', thumbnail: svg('#0C0B0A', 'Screen'), canShow: false },
  ]
}
