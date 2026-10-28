import { spawn } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// The MCP server in resources/bin/tezgah-cli.js, spoken to over stdio like an agent would.
function session(messages: object[]): Promise<Record<number, { result?: { tools?: { name: string }[]; content?: { text: string }[]; isError?: boolean; protocolVersion?: string } }>> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env }
    delete env.TEZGAH_SOCKET
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
