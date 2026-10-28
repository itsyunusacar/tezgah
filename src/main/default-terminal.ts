import { app } from 'electron'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// Making Tezgah the terminal the system opens: on macOS, the handler for shell scripts (.command, .sh)
// and ssh:// links; on Linux, GNOME's default terminal. Windows has no setting an app like this can
// fill (its default terminal is a COM delegation), so the installer adds "Open in Tezgah" instead.

export type DefaultTerminal = { supported: false } | { supported: true; isDefault: boolean }

const run = (cmd: string, args: string[]) =>
  new Promise<string>((resolve) => execFile(cmd, args, { timeout: 10_000 }, (err, out) => resolve(err ? '' : out.trim())))

/** The app's bundle identifier, read from its Info.plist (it differs in development). */
function bundleId(): string {
  try {
    const plist = fs.readFileSync(path.join(path.dirname(process.execPath), '..', 'Info.plist'), 'utf8')
    return plist.match(/<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/)?.[1] ?? 'dev.tezgah.app'
  } catch {
    return 'dev.tezgah.app'
  }
}

const MAC_TYPES = ['com.apple.terminal.shell-script', 'public.unix-executable']

/** Runs JavaScript for Automation with Launch Services. */
const jxa = (body: string) => run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', `ObjC.import('CoreServices');\n${body}`])

/** Where Linux desktops start Tezgah from: the AppImage, or the installed binary. */
const linuxExec = () => process.env.APPIMAGE || process.execPath

export async function status(): Promise<DefaultTerminal> {
  if (process.platform === 'darwin') {
    const current = await jxa(`ObjC.unwrap($.LSCopyDefaultRoleHandlerForContentType($('${MAC_TYPES[0]}'), $.kLSRolesShell)) || ''`)
    return { supported: true, isDefault: current.toLowerCase() === bundleId().toLowerCase() }
  }
  if (process.platform === 'linux') {
    const exec = await run('gsettings', ['get', 'org.gnome.desktop.default-applications.terminal', 'exec'])
    if (!exec) return { supported: false }
    return { supported: true, isDefault: exec.replace(/'/g, '') === linuxExec() }
  }
  return { supported: false }
}

export async function makeDefault(): Promise<DefaultTerminal> {
  if (process.platform === 'darwin') {
    const id = bundleId()
    await jxa(
      [
        ...MAC_TYPES.map((t) => `$.LSSetDefaultRoleHandlerForContentType($('${t}'), $.kLSRolesShell, $('${id}'));`),
        `$.LSSetDefaultHandlerForURLScheme($('ssh'), $('${id}'));`,
      ].join('\n'),
    )
    app.setAsDefaultProtocolClient('ssh')
  } else if (process.platform === 'linux') {
    await run('gsettings', ['set', 'org.gnome.desktop.default-applications.terminal', 'exec', linuxExec()])
    await run('gsettings', ['set', 'org.gnome.desktop.default-applications.terminal', 'exec-arg', '-x'])
  }
  return status()
}
