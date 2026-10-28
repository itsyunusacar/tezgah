// A stand-in coding agent for screenshots and the demo recording (docs/README). It prints a
// Claude Code-like transcript and reports its state to Tezgah with OSC 7501, like the real one.
//   node fake-agent.mjs <scenario>
import readline from 'node:readline'

const scenario = process.argv[2] ?? 'login'
const b64 = (s) => Buffer.from(s).toString('base64')
const report = (state, msg = '', kind = '', app = 'claude') =>
  process.stdout.write(`\x1b]7501;state=${state}:app=${app}${kind ? ':kind=' + kind : ''}${msg ? ':msg=' + b64(msg) : ''}\x07`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = (s = '') => process.stdout.write(s + '\r\n')
const dim = (s) => `\x1b[2m${s}\x1b[0m`
const orange = (s) => `\x1b[38;2;215;119;87m${s}\x1b[0m`
const green = (s) => `\x1b[32m${s}\x1b[0m`
const bold = (s) => `\x1b[1m${s}\x1b[0m`

process.stdin.setRawMode?.(true)
const keys = readline.createInterface({ input: process.stdin })
const enter = () => new Promise((r) => process.stdin.once('data', r))
void keys

function header(model = 'Opus 5.5', dir = '~/acme/web') {
  out(orange(' ▐▛███▜▌') + `   ${bold('Claude Code')} ${dim('v2.1.312')}`)
  out(orange('▝▜█████▛▘') + `  ${dim(model + ' · Claude Max')}`)
  out(orange('  ▘▘ ▝▝') + `    ${dim(dir)}`)
  out()
}

async function tool(name, arg, result, ms = 900) {
  out(`${green('⏺')} ${bold(name)}(${arg})`)
  await sleep(ms)
  out(`  ${dim('⎿')}  ${dim(result)}`)
  out()
}

const scenarios = {
  async login() {
    header()
    out(`${dim('>')} The login form accepts expired tokens. Fix it and add a test.`)
    out()
    report('working', 'Read src/auth/session.ts')
    await tool('Read', 'src/auth/session.ts', 'Read 142 lines')
    report('working', 'Edit src/auth/session.ts')
    await tool('Update', 'src/auth/session.ts', 'Updated with 12 additions and 3 removals', 1400)
    report('working', 'Write src/auth/session.test.ts')
    await tool('Write', 'src/auth/session.test.ts', 'Wrote 48 lines', 1200)
    out(`${green('⏺')} ${bold('Bash')}(npm test -- auth)`)
    out()
    out(`  ${bold('Allow Claude to run')} npm test -- auth?`)
    out(`  ${orange('❯ 1. Yes')}`)
    out(`    2. Yes, and don't ask again for npm test`)
    out(`    3. No, tell Claude what to do differently ${dim('(esc)')}`)
    report('blocked', 'Bash npm test -- auth', 'permission')
    await enter()
    report('working', 'Bash npm test -- auth')
    await sleep(1600)
    out(`  ${dim('⎿')}  ${green('✓')} 14 passed ${dim('(1.8s)')}`)
    out()
    out(`${green('⏺')} Expired tokens are now rejected and refreshed once; a test covers both paths.`)
    report('done')
    await enter()
  },
  async darkmode() {
    header('Opus 5.5', '~/acme/web')
    out(`${dim('>')} Add a dark mode that follows the system setting.`)
    out()
    const steps = ['Read src/styles/tokens.css', 'Grep "--color-"', 'Edit src/styles/tokens.css', 'Edit src/App.tsx', 'Read src/components/Header.tsx', 'Edit src/components/Header.tsx']
    for (let i = 0; ; i++) {
      const s = steps[i % steps.length]
      report('working', s + ' · 2 agents')
      const [name, ...rest] = s.split(' ')
      await tool(name === 'Edit' ? 'Update' : name, rest.join(' '), name === 'Edit' ? 'Updated' : 'Done', 1600)
    }
  },
  async codex() {
    out(bold('>_ OpenAI Codex') + dim('  (v0.159)'))
    out(dim('model: gpt-5-codex · directory: ~/acme/api'))
    out()
    out(`${dim('user')} Migrate the orders table to the new schema.`)
    out()
    report('working', 'shell psql -f migrations/024.sql', '', 'codex')
    out(`${green('•')} Ran ${bold('cat migrations/024.sql')}`)
    await sleep(1200)
    out()
    out(`${bold('Allow Codex to apply this patch?')}  ${dim('migrations/025_orders.sql')}`)
    out(`  ${orange('› 1. Yes, proceed')}`)
    out(`    2. No, and tell Codex what to do differently`)
    report('blocked', 'apply_patch migrations/025_orders.sql', 'permission', 'codex')
    await enter()
    report('working', 'apply_patch migrations/025_orders.sql', '', 'codex')
    await sleep(1500)
    out(`${green('✓')} Applied. The migration runs in 0.4s on a copy of production data.`)
    report('done', '', '', 'codex')
    await enter()
  },
  async tests() {
    header('Sonnet 5.5', '~/acme/api')
    out(`${dim('>')} Why do the payment tests fail on CI only?`)
    out()
    const steps = ['Bash pytest tests/payments -x', 'Read tests/conftest.py', 'Grep "TZ"', 'Read .github/workflows/ci.yml']
    for (let i = 0; ; i++) {
      report('working', steps[i % steps.length])
      const [name, ...rest] = steps[i % steps.length].split(' ')
      await tool(name, rest.join(' '), name === 'Bash' ? '2 failed, 31 passed' : 'Read', 1900)
    }
  },
  async grok() {
    out(bold('Grok') + dim('  grok-code · ~/acme/docs'))
    out()
    out(`${dim('›')} Write the README section for the new export command.`)
    out()
    out(`Added ${bold('## Exporting')} to README.md with three examples and the flags table.`)
    out()
    report('done', '', '', 'grok')
    await enter()
  },
}

await (scenarios[scenario] ?? scenarios.login)()
process.exit(0)
