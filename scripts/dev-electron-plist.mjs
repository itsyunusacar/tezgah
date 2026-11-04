// macOS only. The Electron.app that `npm run dev` launches has no privacy strings for the
// Desktop, Documents and Downloads folders, so macOS denies terminals there without asking
// ("Operation not permitted"). Add them, name it "Tezgah Dev", and re-sign ad hoc.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

if (process.platform !== 'darwin') process.exit(0)
const app = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'node_modules', 'electron', 'dist', 'Electron.app')
const plist = path.join(app, 'Contents', 'Info.plist')
if (!fs.existsSync(plist)) process.exit(0)

const set = (key, value) => {
  try {
    execFileSync('plutil', ['-replace', key, '-string', value, plist])
  } catch {
    execFileSync('plutil', ['-insert', key, '-string', value, plist])
  }
}
set('NSDesktopFolderUsageDescription', 'Terminals in Tezgah can read and write files in your Desktop folder.')
set('NSDocumentsFolderUsageDescription', 'Terminals in Tezgah can read and write files in your Documents folder.')
set('NSDownloadsFolderUsageDescription', 'Terminals in Tezgah can read and write files in your Downloads folder.')
set('CFBundleDisplayName', 'Tezgah Dev')
set('CFBundleIdentifier', 'dev.tezgah.app.dev')
// Editing Info.plist invalidates the signature; Apple silicon refuses to run unsigned apps.
execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'ignore' })
