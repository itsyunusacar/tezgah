// node-pty's prebuilt spawn-helper loses its executable bit when npm unpacks it,
// which makes every terminal fail with "posix_spawnp failed". Restore it.
import fs from 'node:fs'
import path from 'node:path'

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'node_modules', 'node-pty')
for (const dir of ['prebuilds', 'build/Release']) {
  const base = path.join(root, dir)
  if (!fs.existsSync(base)) continue
  for (const entry of fs.readdirSync(base, { recursive: true })) {
    if (path.basename(String(entry)) === 'spawn-helper') fs.chmodSync(path.join(base, String(entry)), 0o755)
  }
}
