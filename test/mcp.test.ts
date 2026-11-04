import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// The MCP server in resources/bin/tezgah-cli.js, spoken to over stdio like an agent would.
function session(messages: object[], extra: Record<string, string> = {}): Promise<Record<number, { result?: { tools?: { name: string }[]; content?: { text: string }[]; isError?: boolean; protocolVersion?: string } }>> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env }
    delete env.TEZGAH_SOCKET
    Object.assign(env, extra)
    const child = spawn(process.execPath, [path.join(__dirname, '../resources/bin/tezgah-cli.js'), 'mcp'], { env })
    const replies: Record<number, never> = {}
    let buf = ''
    child.stdout.on('data', (d) => {
      buf += d
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const msg = JSON.parse(buf.slice(0, nl))
        buf = buf.slice(nl + 1)
        replies[msg.id] = msg as never
        if (Object.keys(replies).length === messages.filter((m) => 'id' in m).length) {
          child.stdin.end()
          resolve(replies)
        }
      }
    })
    child.on('error', reject)
    for (const m of messages) child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n')
  })
}

describe('tezgah mcp', () => {
  it('initializes, lists its tools and reports errors as tool results', async () => {
    const r = await session([
      { id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
      { method: 'notifications/initialized' },
      { id: 2, method: 'tools/list' },
      { id: 3, method: 'tools/call', params: { name: 'browser_snapshot', arguments: {} } },
      { id: 4, method: 'nope' },
    ])
    expect(r[1].result?.protocolVersion).toBe('2025-06-18')
    const names = r[2].result!.tools!.map((t) => t.name)
    expect(names).toContain('browser_click')
    expect(names).toContain('terminal_read')
    expect(r[3].result?.isError).toBe(true)
    expect(r[3].result?.content?.[0].text).toMatch(/inside a Tezgah terminal/)
    expect((r[4] as { error?: { code: number } }).error?.code).toBe(-32601)
  })
})

describe('tezgah command', () => {
  // The CLI against a server that hangs up without answering, like the app does for a request over 1 MB.
  function cli(args: string[], onLine: (conn: net.Socket) => void): Promise<{ code: number | null; err: string }> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tezgah-cli-'))
    const socket = process.platform === 'win32' ? `\\\\.\\pipe\\tezgah-test-${process.pid}` : path.join(dir, 's.sock')
    const server = net.createServer((conn) => conn.once('data', () => onLine(conn)))
    return new Promise((resolve) =>
      server.listen(socket, () => {
        const child = spawn(process.execPath, [path.join(__dirname, '../resources/bin/tezgah-cli.js'), ...args], { env: { ...process.env, TEZGAH_SOCKET: socket } })
        let err = ''
        child.stderr.on('data', (d) => (err += d))
        child.on('exit', (code) => {
          server.close()
          fs.rmSync(dir, { recursive: true, force: true })
          resolve({ code, err })
        })
      }),
    )
  }

  it('fails when the app hangs up without answering', async () => {
    const r = await cli(['notify', 'hi'], (conn) => conn.destroy())
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/closed the connection without answering/)
  })

  it('prints the app’s error and fails', async () => {
    const r = await cli(['read', '--pane', 'x'], (conn) => conn.end(JSON.stringify({ ok: false, error: 'no such pane' }) + '\n'))
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/no such pane/)
  })

  it('refuses a request over 1 MB before sending it', async () => {
    const big = 'x'.repeat(1.1 * (1 << 20))
    const r = await session([{ id: 1, method: 'tools/call', params: { name: 'terminal_send', arguments: { pane: 'p', text: big } } }], { TEZGAH_SOCKET: path.join(os.tmpdir(), 'tezgah-none.sock') })
    expect(r[1].result?.isError).toBe(true)
    expect(r[1].result?.content?.[0].text).toMatch(/over 1 MB/)
  })
})
