import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// "Open in Tezgah" on folders in Finder. Finder offers Open With for files only, never for folders, so
// Tezgah puts a Quick Action (an Automator service) in ~/Library/Services: right-click a folder →
// Quick Actions → Open in Tezgah. It runs `open -a` with this copy of Tezgah, rewritten if the app moves.

/** Where the Quick Action goes (a temporary folder in tests); its menu title is in the app's language. */
export const serviceDir = (home = os.homedir()) => path.join(home, 'Library', 'Services', 'Open in Tezgah.workflow')

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

const plist = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
${body}
</plist>
`

/** The service's Info.plist: its menu title, for folders, in Finder. */
function info(title: string): string {
  return plist(`<dict>
	<key>NSServices</key>
	<array>
		<dict>
			<key>NSBackgroundColorName</key>
			<string>background</string>
			<key>NSIconName</key>
			<string>NSActionTemplate</string>
			<key>NSMenuItem</key>
			<dict>
				<key>default</key>
				<string>${xml(title)}</string>
			</dict>
			<key>NSMessage</key>
			<string>runWorkflowAsService</string>
			<key>NSRequiredContext</key>
			<dict>
				<key>NSApplicationIdentifier</key>
				<string>com.apple.finder</string>
			</dict>
			<key>NSSendFileTypes</key>
			<array>
				<string>public.folder</string>
			</array>
		</dict>
	</array>
</dict>`)
}

/** Automator's document: one Run Shell Script action, the chosen folders as its arguments. */
function document(command: string): string {
  const arg = (n: number, name: string, value: string) => `				<key>${n}</key>
				<dict>
					<key>default value</key>
					${value}
					<key>name</key>
					<string>${name}</string>
					<key>required</key>
					<string>0</string>
					<key>type</key>
					<string>0</string>
					<key>uuid</key>
					<string>${n}</string>
				</dict>`
  const finder = '/System/Library/CoreServices/Finder.app'
  return plist(`<dict>
	<key>AMApplicationBuild</key>
	<string>534</string>
	<key>AMApplicationVersion</key>
	<string>2.10</string>
	<key>AMDocumentVersion</key>
	<string>2</string>
	<key>actions</key>
	<array>
		<dict>
			<key>action</key>
			<dict>
				<key>AMAccepts</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Optional</key>
					<true/>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.string</string>
					</array>
				</dict>
				<key>AMActionVersion</key>
				<string>2.0.3</string>
				<key>AMApplication</key>
				<array>
					<string>Automator</string>
				</array>
				<key>AMParameterProperties</key>
				<dict>
					<key>COMMAND_STRING</key>
					<dict/>
					<key>CheckedForUserDefaultShell</key>
					<dict/>
					<key>inputMethod</key>
					<dict/>
					<key>shell</key>
					<dict/>
					<key>source</key>
					<dict/>
				</dict>
				<key>AMProvides</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.string</string>
					</array>
				</dict>
				<key>ActionBundlePath</key>
				<string>/System/Library/Automator/Run Shell Script.action</string>
				<key>ActionName</key>
				<string>Run Shell Script</string>
				<key>ActionParameters</key>
				<dict>
					<key>COMMAND_STRING</key>
					<string>${xml(command)}</string>
					<key>CheckedForUserDefaultShell</key>
					<true/>
					<key>inputMethod</key>
					<integer>1</integer>
					<key>shell</key>
					<string>/bin/zsh</string>
					<key>source</key>
					<string></string>
				</dict>
				<key>BundleIdentifier</key>
				<string>com.apple.RunShellScript</string>
				<key>CFBundleVersion</key>
				<string>2.0.3</string>
				<key>CanShowSelectedItemsWhenRun</key>
				<false/>
				<key>CanShowWhenRun</key>
				<true/>
				<key>Category</key>
				<array>
					<string>AMCategoryUtilities</string>
				</array>
				<key>Class Name</key>
				<string>RunShellScriptAction</string>
				<key>InputUUID</key>
				<string>6B0C33E2-3F0E-4E57-9A5B-2B7E3A1C9D01</string>
				<key>Keywords</key>
				<array>
					<string>Shell</string>
					<string>Script</string>
					<string>Command</string>
					<string>Run</string>
					<string>Unix</string>
				</array>
				<key>OutputUUID</key>
				<string>6B0C33E2-3F0E-4E57-9A5B-2B7E3A1C9D02</string>
				<key>UUID</key>
				<string>6B0C33E2-3F0E-4E57-9A5B-2B7E3A1C9D03</string>
				<key>UnlocalizedApplications</key>
				<array>
					<string>Automator</string>
				</array>
				<key>arguments</key>
				<dict>
${[arg(0, 'inputMethod', '<integer>0</integer>'), arg(1, 'CheckedForUserDefaultShell', '<false/>'), arg(2, 'source', '<string></string>'), arg(3, 'COMMAND_STRING', '<string></string>'), arg(4, 'shell', '<string>/bin/sh</string>')].join('\n')}
				</dict>
				<key>conversionLabel</key>
				<integer>0</integer>
				<key>isViewVisible</key>
				<integer>1</integer>
				<key>location</key>
				<string>309.000000:305.000000</string>
				<key>nibPath</key>
				<string>/System/Library/Automator/Run Shell Script.action/Contents/Resources/Base.lproj/main.nib</string>
			</dict>
			<key>isViewVisible</key>
			<integer>1</integer>
		</dict>
	</array>
	<key>connectors</key>
	<dict/>
	<key>workflowMetaData</key>
	<dict>
		<key>applicationBundleID</key>
		<string>com.apple.finder</string>
		<key>applicationBundleIDsByPath</key>
		<dict>
			<key>${finder}</key>
			<string>com.apple.finder</string>
		</dict>
		<key>applicationPath</key>
		<string>${finder}</string>
		<key>applicationPaths</key>
		<array>
			<string>${finder}</string>
		</array>
		<key>inputTypeIdentifier</key>
		<string>com.apple.Automator.fileSystemObject.folder</string>
		<key>outputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>presentationMode</key>
		<integer>15</integer>
		<key>processesInput</key>
		<false/>
		<key>serviceApplicationBundleID</key>
		<string>com.apple.finder</string>
		<key>serviceApplicationPath</key>
		<string>${finder}</string>
		<key>serviceInputTypeIdentifier</key>
		<string>com.apple.Automator.fileSystemObject.folder</string>
		<key>serviceOutputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>serviceProcessesInput</key>
		<false/>
		<key>systemImageName</key>
		<string>NSActionTemplate</string>
		<key>useAutomaticInputType</key>
		<false/>
		<key>workflowTypeIdentifier</key>
		<string>com.apple.Automator.servicesMenu</string>
	</dict>
</dict>`)
}

/** The shell line it runs: this copy of Tezgah, or whichever has its bundle id should it have moved. */
export const command = (appPath: string, bundleId: string) => `open -a ${sh(appPath)} "$@" || open -b ${sh(bundleId)} "$@"`

/** Both files of the Quick Action, by path inside the bundle. */
export function workflowFiles(title: string, appPath: string, bundleId: string): Record<string, string> {
  return { 'Contents/Info.plist': info(title), 'Contents/document.wflow': document(command(appPath, bundleId)) }
}

/** Puts the Quick Action in place, or brings it up to date; true when anything was written. */
export function install(dir: string, title: string, appPath: string, bundleId: string): boolean {
  let changed = false
  for (const [name, content] of Object.entries(workflowFiles(title, appPath, bundleId))) {
    const file = path.join(dir, name)
    let current: string | undefined
    try {
      current = fs.readFileSync(file, 'utf8')
    } catch {
      // Not there yet.
    }
    if (current === content) continue
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
    changed = true
  }
  return changed
}

/** Takes it away; true when there was one. */
export function remove(dir: string): boolean {
  if (!fs.existsSync(dir)) return false
  fs.rmSync(dir, { recursive: true, force: true })
  return true
}

/** Tells macOS the services changed, so Finder's menu shows it now rather than after logging in again. */
export function refreshServices(): void {
  execFile('/System/Library/CoreServices/pbs', ['-update'], { timeout: 15_000 }, () => undefined)
}

/** The key macOS keeps a service's on/off under, by its menu title. */
export const statusKey = (title: string) => `(null) - ${title} - runWorkflowAsService`

/** A service macOS has no word on yet starts switched off in Finder's menu: switch it on, once. One the
 *  user turned off in System Settings keeps its entry, and is left alone. */
function enable(title: string, then: () => void): void {
  // `defaults export` keeps letters like ç as they are; `defaults read` escapes them (\U00e7).
  execFile('defaults', ['export', 'pbs', '-'], { timeout: 15_000 }, (_e, out) => {
    if ((out ?? '').includes(`<key>${statusKey(title).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</key>`)) return then()
    const on = '{ "enabled_context_menu" = 1; "enabled_services_menu" = 1; "presentation_modes" = { ContextMenu = 1; ServicesMenu = 1; FinderPreview = 1; TouchBar = 1; }; }'
    execFile('defaults', ['write', 'pbs', 'NSServicesStatus', '-dict-add', `"${statusKey(title)}"`, on], { timeout: 15_000 }, () => then())
  })
}

/** At launch and when the setting changes: there when `on`, gone when not. Never throws. */
export function sync(on: boolean, title: string, appPath: string, bundleId: string, dir = serviceDir()): void {
  try {
    if (!on) return void (remove(dir) && refreshServices())
    install(dir, title, appPath, bundleId)
    enable(title, refreshServices)
  } catch (e) {
    console.error('Finder Quick Action:', (e as Error).message)
  }
}
