// electron-builder afterPack hook: signs the macOS app with Tezgah's own (self-signed) certificate, so
// macOS keeps the permissions people give Tezgah (Screen Recording) from one update to the next. Without
// a real signature the app calls itself "Electron" and macOS never matches it to the permission.
//
// Runs only when MAC_SIGN_P12 (base64 of the .p12) and MAC_SIGN_PASSWORD are set, as in the release
// workflow; local builds stay unsigned. A Developer ID (CSC_LINK) takes precedence: electron-builder
// signs with it after this hook. No hardened runtime: that needs notarization, which needs a paid account.
const { execFileSync } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

exports.default = async function sign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const p12 = process.env.MAC_SIGN_P12
  const password = process.env.MAC_SIGN_PASSWORD
  if (!p12 || !password || process.env.CSC_LINK) return

  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tezgah-sign-'))
  const keychain = path.join(dir, 'sign.keychain-db')
  const pass = crypto.randomBytes(16).toString('hex')
  const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'] }).toString()
  try {
    fs.writeFileSync(path.join(dir, 'cert.p12'), Buffer.from(p12, 'base64'), { mode: 0o600 })
    run('security', ['create-keychain', '-p', pass, keychain])
    run('security', ['unlock-keychain', '-p', pass, keychain])
    run('security', ['import', path.join(dir, 'cert.p12'), '-k', keychain, '-P', password, '-T', '/usr/bin/codesign'])
    run('security', ['set-key-partition-list', '-S', 'apple-tool:,apple:', '-s', '-k', pass, keychain])
    // Self-signed, so not "valid" to the system: pick it by its SHA-1.
    const id = run('security', ['find-identity', '-p', 'codesigning', keychain]).match(/\b([0-9A-F]{40})\b/)?.[1]
    if (!id) throw new Error('No signing identity in MAC_SIGN_P12')
    run('codesign', ['--force', '--deep', '--timestamp=none', '--sign', id, '--keychain', keychain, app])
    run('codesign', ['--verify', '--deep', '--strict', app])
    console.log(`  • signed ${path.basename(app)} with Tezgah's certificate (${id.slice(0, 8)}…)`)
  } finally {
    try { run('security', ['delete-keychain', keychain]) } catch { /* already gone */ }
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
