// Tezgah's command line. Talks to the running app over a local socket (a named pipe on Windows).
// Started by the `tezgah` launcher with Tezgah's own runtime, so it needs nothing else installed.
'use strict'

const net = require('node:net')
const path = require('node:path')

const HELP = `tezgah — control Tezgah from its terminals

Usage:
  tezgah notify [--title <title>] <message>    Send a notification (rings the pane, shows in the panel)
  tezgah status <working|done|blocked|idle|clear> [message]
                                               Set this pane's status in the sidebar
  tezgah split [right|down] [-- <command>]     Split this pane; run a command in the new one
  tezgah new [--shell] [--dir <path>] [--title <title>] [-- <command>]
                                               New session (Claude by default)
  tezgah open <url|folder>                     A URL opens in a browser pane, a folder as a project
  tezgah browser <url|reload|back|text|eval <js>>
                                               Drive this session's browser pane
  tezgah send [--pane <id>] [--enter] <text>   Type text into a pane
  tezgah read [--pane <id>] [--lines <n>]      Print what a pane shows
  tezgah list [--json]                         Sessions and panes
  tezgah run <name>                            Run one of your custom commands
  tezgah focus <session-id>                    Show a session

Inside Tezgah, "this pane" is the terminal you run the command in.`

function parse(argv) {
  const out = { _: [], rest: undefined }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') {
      out.rest = argv.slice(i + 1).join(' ')
      break
    }
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (['enter', 'shell', 'json', 'help'].includes(key)) out[key] = true
      else {
        out[key] = next
        i++
      }
    } else if (a === '-h') out.help = true
    else out._.push(a)
  }
  return out
}

function request(cmd, args) {
  const socket = process.env.TEZGAH_SOCKET
  if (!socket) {
    console.error('tezgah: run this inside a Tezgah terminal')
    process.exit(1)
  }
  return new Promise((resolve, reject) => {
    const conn = net.connect(socket)
    let buf = ''
    conn.setEncoding('utf8')
    conn.on('connect', () => conn.write(JSON.stringify({ cmd, args, pane: process.env.TEZGAH_PANE_ID, cwd: process.cwd() }) + '\n'))
    conn.on('data', (d) => {
      buf += d
      const nl = buf.indexOf('\n')
      if (nl < 0) return
      conn.end()
      try {
        const res = JSON.parse(buf.slice(0, nl))
        res.ok ? resolve(res.result) : reject(new Error(res.error))
      } catch (e) {
        reject(e)
      }
    })
    conn.on('error', () => reject(new Error('Tezgah is not running')))
  })
}

async function main() {
  const [cmd, ...argv] = process.argv.slice(2)
  const a = parse(argv)
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h' || a.help) {
    console.log(HELP)
    return
  }
  let args
  switch (cmd) {
    case 'notify':
      if (!a._.length) throw new Error('usage: tezgah notify [--title <title>] <message>')
      args = { title: a.title, body: a._.join(' ') }
      break
    case 'status':
      if (!a._[0]) throw new Error('usage: tezgah status <working|done|blocked|idle|clear> [message]')
      args = { state: a._[0], message: a._.slice(1).join(' ') || undefined }
      break
    case 'split':
      args = { dir: a._[0] === 'down' ? 'column' : 'row', command: a.rest }
      break
    case 'new':
      args = { kind: a.shell || a.rest ? 'shell' : 'claude', dir: a.dir ? path.resolve(a.dir) : undefined, title: a.title, command: a.rest }
      break
    case 'open': {
      const target = a._[0]
      if (!target) throw new Error('usage: tezgah open <url|folder>')
      const isUrl = /^([a-z]+:\/\/|data:|about:)/i.test(target) || /^(localhost|127\.0\.0\.1)(:\d+)?/.test(target)
      args = isUrl ? { url: target } : { path: path.resolve(target) }
      break
    }
    case 'browser':
      if (!a._[0]) throw new Error('usage: tezgah browser <url|reload|back|text|eval <js>>')
      args = ['reload', 'back', 'forward', 'text', 'eval'].includes(a._[0])
        ? { action: a._[0], script: a._.slice(1).join(' ') }
        : { action: 'open', url: a._[0] }
      break
    case 'send':
      args = { pane: a.pane, text: a._.join(' '), enter: !!a.enter }
      break
    case 'read':
      args = { pane: a.pane, lines: a.lines ? Number(a.lines) : undefined }
      break
    case 'list':
      args = {}
      break
    case 'run':
      if (!a._[0]) throw new Error('usage: tezgah run <name>')
      args = { name: a._.join(' ') }
      break
    case 'focus':
      args = { session: a._[0] }
      break
    default:
      throw new Error(`unknown command "${cmd}". Run tezgah help.`)
  }
  const result = await request(cmd, args)
  if (cmd === 'list' && !a.json) {
    for (const s of result) {
      console.log(`${s.id}  ${s.project} / ${s.title}${s.status ? `  [${s.status}]` : ''}`)
      for (const p of s.panes) console.log(`    ${p.id}  ${p.kind}${p.focused ? ' *' : ''}${p.url ? '  ' + p.url : ''}`)
    }
    return
  }
  if (result === undefined || result === null || result === true) return
  console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2))
}

main().catch((e) => {
  console.error(`tezgah: ${e.message}`)
  process.exit(1)
})
