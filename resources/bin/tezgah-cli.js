// Tezgah's command line, and its MCP server (`tezgah mcp`). Talks to the running app over a local
// socket (a named pipe on Windows). Started by the `tezgah` launcher with Tezgah's own runtime, so it
// needs nothing else installed, and any agent that can run a command can use it.
'use strict'

const net = require('node:net')
const path = require('node:path')

const HELP = `tezgah — control Tezgah from its terminals

Sessions and panes
  tezgah notify [--title <title>] <message>    Notify (rings the pane, shows in the panel)
  tezgah status <working|done|blocked|idle|clear> [message]
                                               Set this pane's status in the sidebar
  tezgah split [right|down] [-- <command>]     Split this pane; run a command in the new one
  tezgah new [--shell] [--dir <path>] [--title <title>] [-- <command>]
                                               New session (Claude by default)
  tezgah open <url|folder>                     A URL opens in a browser pane, a folder as a project
  tezgah send [--pane <id>] [--enter] <text>   Type text into a pane (default: this session's Claude)
  tezgah read [--pane <id>] [--lines <n>]      Print what a pane shows (default: this one)
  tezgah list [--json]                         Sessions and panes
  tezgah run <name>                            Run one of your custom commands
  tezgah focus <session-id>                    Show a session

Browser (this session's browser pane; --pane <id> picks another)
  tezgah browser open <url> [--new]            Open a page (a new pane with --new) and wait for it
  tezgah browser snapshot [--interactive]      The page as text, every element with a ref (e12)
  tezgah browser click <target> [--double] [--right]
  tezgah browser fill <target> <text>          Replace a field's text
  tezgah browser type [--into <target>] <text> Type at the focus (or into a field)
  tezgah browser press <keys…>                 Enter, Tab, Escape, ArrowDown, Control+a…
  tezgah browser select <target> <option>      Pick an option in a <select>
  tezgah browser hover <target>
  tezgah browser scroll [up|down|top|bottom] [--to <target>]
  tezgah browser screenshot [<target>]         Saves a PNG and prints its path
  tezgah browser wait [--text <t>] [--gone <t>] [--selector <css>] [--url <part>] [--ms <n>] [--timeout <ms>]
  tezgah browser console [--errors] [--clear]  What the page logged
  tezgah browser network [--failed] [--clear]  Requests it made
  tezgah browser text | url | eval <js> | back | forward | reload

  A target is a ref from the latest snapshot (e12), a CSS selector, or text=<visible text>.

Agents
  tezgah mcp                                   Run as an MCP server (stdio) with these tools

Inside Tezgah, "this pane" is the terminal you run the command in.`

const FLAGS = new Set(['enter', 'shell', 'json', 'help', 'interactive', 'double', 'right', 'errors', 'failed', 'clear', 'new'])

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
      if (FLAGS.has(key)) out[key] = true
      else {
        out[key] = argv[i + 1]
        i++
      }
    } else if (a === '-h') out.help = true
    else out._.push(a)
  }
  return out
}

function request(cmd, args) {
  const socket = process.env.TEZGAH_SOCKET
  if (!socket) return Promise.reject(new Error('run this inside a Tezgah terminal'))
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

const usage = (text) => {
  throw new Error(`usage: ${text}`)
}

/** `tezgah browser …` → the args the app expects. */
function browserArgs(a) {
  const [action, ...rest] = a._
  const pane = a.pane
  const target = rest[0]
  switch (action) {
    case 'open':
      if (!target) usage('tezgah browser open <url> [--new]')
      return { action: 'open', url: target, newPane: !!a.new, pane }
    case 'snapshot':
      return { action, interactive: !!a.interactive, limit: a.limit ? Number(a.limit) : undefined, pane }
    case 'click':
    case 'hover':
      if (!target) usage(`tezgah browser ${action} <ref|selector|text=…>`)
      return { action, target, double: !!a.double, right: !!a.right, pane }
    case 'fill':
      if (!target) usage('tezgah browser fill <target> <text>')
      return { action, target, text: rest.slice(1).join(' '), pane }
    case 'type':
      return { action, target: a.into, text: rest.join(' '), pane }
    case 'press':
      if (!rest.length) usage('tezgah browser press <keys…>')
      return { action, key: rest.join(' '), pane }
    case 'select':
      if (!target || rest.length < 2) usage('tezgah browser select <target> <option>')
      return { action, target, value: rest.slice(1).join(' '), pane }
    case 'scroll':
      return { action, direction: target, target: a.to, amount: a.amount ? Number(a.amount) : undefined, pane }
    case 'screenshot':
      return { action, target, pane }
    case 'wait':
      return { action, text: a.text, gone: a.gone, selector: a.selector, url: a.url, ms: a.ms ? Number(a.ms) : undefined, timeout: a.timeout ? Number(a.timeout) : undefined, pane }
    case 'console':
      return { action, errors: !!a.errors, clear: !!a.clear, pane }
    case 'network':
      return { action, failed: !!a.failed, clear: !!a.clear, pane }
    case 'eval':
      return { action, script: rest.join(' '), pane }
    case 'url':
      return { action: 'info', pane }
    case 'text':
    case 'back':
    case 'forward':
    case 'reload':
      return { action, pane }
    case undefined:
      return usage('tezgah browser <open|snapshot|click|fill|type|press|select|hover|scroll|screenshot|wait|console|network|text|url|eval|back|forward|reload>')
    default:
      // `tezgah browser <url>` opens it.
      return { action: 'open', url: action, pane }
  }
}

async function cli(cmd, a) {
  let args
  switch (cmd) {
    case 'notify':
      if (!a._.length) usage('tezgah notify [--title <title>] <message>')
      args = { title: a.title, body: a._.join(' ') }
      break
    case 'status':
      if (!a._[0]) usage('tezgah status <working|done|blocked|idle|clear> [message]')
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
      if (!target) usage('tezgah open <url|folder>')
      const isUrl = /^([a-z]+:\/\/|data:|about:)/i.test(target) || /^(localhost|127\.0\.0\.1)(:\d+)?/.test(target)
      args = isUrl ? { url: target } : { path: path.resolve(target) }
      break
    }
    case 'browser':
      args = browserArgs(a)
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
      if (!a._[0]) usage('tezgah run <name>')
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
  if (cmd === 'browser' && result && typeof result === 'object' && result.path) {
    console.log(result.path)
    return
  }
  if (result === undefined || result === null || result === true) return
  console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2))
}

// MCP server: the same abilities as tools, over JSON-RPC on stdin/stdout.

const TARGET = { type: 'string', description: 'A ref from the latest browser_snapshot (e.g. "e12"), a CSS selector, or "text=<visible text>".' }
const PANE = { type: 'string', description: 'A browser pane id from tezgah_list; defaults to this session\'s browser pane.' }

const TOOLS = [
  {
    name: 'browser_open',
    description: 'Open a URL in a browser pane beside this terminal (Tezgah\'s built-in browser) and wait for it to load. Use it for local dev servers (http://localhost:5173), docs or any page. Reuses the session\'s browser pane unless new_pane is true.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' }, new_pane: { type: 'boolean' }, pane: PANE }, required: ['url'] },
    call: (p) => ({ action: 'open', url: p.url, newPane: !!p.new_pane, pane: p.pane }),
  },
  {
    name: 'browser_snapshot',
    description: 'Read the page as text: headings, text, links, buttons and fields, each actionable element with a ref like e12 to use in browser_click / browser_fill. Refs change with every snapshot. Prefer this over screenshots for finding things.',
    inputSchema: { type: 'object', properties: { interactive_only: { type: 'boolean', description: 'Only elements you can act on; shorter for big pages.' }, pane: PANE } },
    call: (p) => ({ action: 'snapshot', interactive: !!p.interactive_only, pane: p.pane }),
  },
  {
    name: 'browser_click',
    description: 'Click an element with a real mouse click (scrolls it into view first), then wait for any navigation.',
    inputSchema: { type: 'object', properties: { target: TARGET, double: { type: 'boolean' }, right: { type: 'boolean' }, pane: PANE }, required: ['target'] },
    call: (p) => ({ action: 'click', target: p.target, double: !!p.double, right: !!p.right, pane: p.pane }),
  },
  {
    name: 'browser_fill',
    description: 'Replace the text of an input, textarea or editable element by typing it, so frameworks like React see real input events.',
    inputSchema: { type: 'object', properties: { target: TARGET, text: { type: 'string' }, pane: PANE }, required: ['target', 'text'] },
    call: (p) => ({ action: 'fill', target: p.target, text: p.text, pane: p.pane }),
  },
  {
    name: 'browser_type',
    description: 'Type text at the current focus, or into target first.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' }, target: TARGET, pane: PANE }, required: ['text'] },
    call: (p) => ({ action: 'type', text: p.text, target: p.target, pane: p.pane }),
  },
  {
    name: 'browser_press',
    description: 'Press keys, space separated: Enter, Tab, Escape, Backspace, ArrowDown, PageDown, or combos like Control+a, Meta+k.',
    inputSchema: { type: 'object', properties: { keys: { type: 'string' }, pane: PANE }, required: ['keys'] },
    call: (p) => ({ action: 'press', key: p.keys, pane: p.pane }),
  },
  {
    name: 'browser_select',
    description: 'Choose an option (by its text or value) in a <select>.',
    inputSchema: { type: 'object', properties: { target: TARGET, option: { type: 'string' }, pane: PANE }, required: ['target', 'option'] },
    call: (p) => ({ action: 'select', target: p.target, value: p.option, pane: p.pane }),
  },
  {
    name: 'browser_hover',
    description: 'Move the mouse over an element (menus, tooltips).',
    inputSchema: { type: 'object', properties: { target: TARGET, pane: PANE }, required: ['target'] },
    call: (p) => ({ action: 'hover', target: p.target, pane: p.pane }),
  },
  {
    name: 'browser_scroll',
    description: 'Scroll the page (up, down, top, bottom) or bring a target into view.',
    inputSchema: { type: 'object', properties: { direction: { type: 'string', enum: ['up', 'down', 'top', 'bottom', 'left', 'right'] }, target: TARGET, pane: PANE } },
    call: (p) => ({ action: 'scroll', direction: p.direction, target: p.target, pane: p.pane }),
  },
  {
    name: 'browser_screenshot',
    description: 'See the page (or one element) as an image. Use it to check layout and visuals; use browser_snapshot to find and act on elements.',
    inputSchema: { type: 'object', properties: { target: TARGET, pane: PANE } },
    call: (p) => ({ action: 'screenshot', target: p.target, base64: true, pane: p.pane }),
    image: true,
  },
  {
    name: 'browser_wait',
    description: 'Wait until text appears, text goes away, a selector exists, the URL contains something, or for a number of milliseconds. Without arguments, waits for the page to finish loading.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' }, gone: { type: 'string' }, selector: { type: 'string' }, url: { type: 'string' }, ms: { type: 'number' }, timeout: { type: 'number', description: 'Milliseconds, default 10000, max 120000.' }, pane: PANE },
    },
    call: (p) => ({ action: 'wait', ...p }),
  },
  {
    name: 'browser_console',
    description: 'What the page logged to its console, including uncaught errors. Check it after an action that seemed to do nothing.',
    inputSchema: { type: 'object', properties: { errors_only: { type: 'boolean' }, clear: { type: 'boolean' }, pane: PANE } },
    call: (p) => ({ action: 'console', errors: !!p.errors_only, clear: !!p.clear, pane: p.pane }),
  },
  {
    name: 'browser_network',
    description: 'Requests the page made, with status codes. failed_only shows errors and 4xx/5xx.',
    inputSchema: { type: 'object', properties: { failed_only: { type: 'boolean' }, clear: { type: 'boolean' }, pane: PANE } },
    call: (p) => ({ action: 'network', failed: !!p.failed_only, clear: !!p.clear, pane: p.pane }),
  },
  {
    name: 'browser_eval',
    description: 'Run JavaScript in the page and return the result (an expression, or statements with return).',
    inputSchema: { type: 'object', properties: { script: { type: 'string' }, pane: PANE }, required: ['script'] },
    call: (p) => ({ action: 'eval', script: p.script, pane: p.pane }),
  },
  {
    name: 'browser_navigate',
    description: 'Go back, forward or reload.',
    inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['back', 'forward', 'reload'] }, pane: PANE }, required: ['action'] },
    call: (p) => ({ action: p.action, pane: p.pane }),
  },
  {
    name: 'terminal_read',
    description: 'Read what another Tezgah pane shows, e.g. a dev server\'s output or test results running beside you. Without pane, reads your own terminal.',
    inputSchema: { type: 'object', properties: { pane: { type: 'string', description: 'A pane id from tezgah_list.' }, lines: { type: 'number' } } },
    cmd: 'read',
    call: (p) => ({ pane: p.pane, lines: p.lines }),
  },
  {
    name: 'terminal_send',
    description: 'Type text into another Tezgah pane (a shell, a REPL, another agent). enter=true submits it.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' }, pane: { type: 'string' }, enter: { type: 'boolean' } }, required: ['text', 'pane'] },
    cmd: 'send',
    call: (p) => ({ text: p.text, pane: p.pane, enter: !!p.enter }),
  },
  {
    name: 'terminal_split',
    description: 'Open a new shell pane beside you, optionally running a command (a dev server, a test watcher). Returns its pane id for terminal_read.',
    inputSchema: { type: 'object', properties: { command: { type: 'string' }, direction: { type: 'string', enum: ['right', 'down'] } } },
    cmd: 'split',
    call: (p) => ({ command: p.command, dir: p.direction === 'down' ? 'column' : 'row' }),
  },
  {
    name: 'tezgah_list',
    description: 'Tezgah\'s sessions and their panes (ids, kinds, browser URLs).',
    inputSchema: { type: 'object', properties: {} },
    cmd: 'list',
    call: () => ({}),
  },
  {
    name: 'tezgah_notify',
    description: 'Send the user a notification, e.g. when a long task finishes or you need a decision.',
    inputSchema: { type: 'object', properties: { message: { type: 'string' }, title: { type: 'string' } }, required: ['message'] },
    cmd: 'notify',
    call: (p) => ({ body: p.message, title: p.title }),
  },
]

const INSTRUCTIONS = `You are running inside Tezgah, a terminal for coding agents. These tools control Tezgah's built-in browser pane (beside your terminal) and its other panes.
To check web work: browser_open the page, browser_snapshot to read it and get refs, act with browser_click / browser_fill / browser_press, then browser_snapshot or browser_screenshot to see the result. browser_console and browser_network show errors.`

function mcp() {
  const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n')
  const reply = (id, result) => send({ jsonrpc: '2.0', id, result })
  const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } })

  async function call(id, name, input) {
    const tool = TOOLS.find((t) => t.name === name)
    if (!tool) return fail(id, -32602, `unknown tool ${name}`)
    try {
      const result = await request(tool.cmd ?? 'browser', tool.call(input ?? {}))
      if (tool.image && result && result.base64) {
        return reply(id, {
          content: [
            { type: 'image', data: result.base64, mimeType: 'image/png' },
            { type: 'text', text: `Saved to ${result.path} (${result.width}×${result.height})` },
          ],
        })
      }
      const text = typeof result === 'string' ? result : result === true || result === undefined ? 'Done.' : JSON.stringify(result, null, 2)
      reply(id, { content: [{ type: 'text', text }] })
    } catch (e) {
      reply(id, { content: [{ type: 'text', text: e.message }], isError: true })
    }
  }

  let buf = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    buf += chunk
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      let msg
      try {
        msg = JSON.parse(line)
      } catch {
        send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })
        continue
      }
      const { id, method, params } = msg
      if (method === 'initialize') {
        reply(id, {
          protocolVersion: (params && params.protocolVersion) || '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'tezgah', version: '1' },
          instructions: INSTRUCTIONS,
        })
      } else if (method === 'tools/list') {
        reply(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) })
      } else if (method === 'tools/call') {
        call(id, params && params.name, params && params.arguments)
      } else if (method === 'ping') {
        reply(id, {})
      } else if (id !== undefined && id !== null) {
        fail(id, -32601, `method not found: ${method}`)
      }
    }
  })
  process.stdin.on('end', () => process.exit(0))
}

// Agent hooks (resources/bin/hooks): the event arrives as JSON on stdin. Always silent and successful,
// so a hook can never slow the agent down, block it, or decide anything for it.
function hook(agent, event) {
  let input = ''
  let sent = false
  const done = () => {
    if (sent) return
    sent = true
    let data = {}
    try {
      data = JSON.parse(input || '{}')
    } catch {
      // Not JSON; the event alone is enough.
    }
    const str = (v) => (typeof v === 'string' ? v : undefined)
    const tool = str(data.tool_name)
    const ti = data.tool_input && typeof data.tool_input === 'object' ? data.tool_input : {}
    const detail = str(ti.command) || str(ti.cmd) || str(ti.file_path) || str(ti.path) || str(ti.pattern) || str(ti.query) || ''
    const args = { agent, event, tool, detail: detail.replace(/\s+/g, ' ').slice(0, 160) }
    const timer = setTimeout(() => process.exit(0), 2000)
    request('hook', args)
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timer)
        process.exit(0)
      })
  }
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (d) => (input += d))
  process.stdin.on('end', done)
  // Some hosts keep stdin open; don't wait for it.
  setTimeout(done, 500)
}

async function main() {
  const [cmd, ...argv] = process.argv.slice(2)
  if (cmd === 'mcp') return mcp()
  if (cmd === 'hook') return hook(argv[0] || 'agent', argv[1] || '')
  const a = parse(argv)
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h' || a.help) {
    console.log(HELP)
    return
  }
  await cli(cmd, a)
}

main().catch((e) => {
  console.error(`tezgah: ${e.message}`)
  process.exit(1)
})
