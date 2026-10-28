import { app, ipcMain, type WebContents } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

// The `tezgah` command talks to the app over a local socket. Requests are one JSON line each;
// the renderer, which owns sessions and panes, does the work and the answer goes back the same way.

export interface ControlRequest {
  cmd: string
  args: Record<string, unknown>
  /** The pane the command was run in (TEZGAH_PANE_ID). */
  pane?: string
  cwd?: string
}

/** One socket per profile, so a development copy and the installed app don't collide. */
export function socketPath(): string {
  const tag = createHash('sha1').update(app.getPath('userData')).digest('hex').slice(0, 10)
  return process.platform === 'win32' ? `\\\\.\\pipe\\tezgah-${tag}` : path.join(os.tmpdir(), `tezgah-${tag}.sock`)
}

/** Where the `tezgah` launcher lives: shipped next to the app, or in the source tree during development. */
export function binDir(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'bin') : path.join(app.getAppPath(), 'resources', 'bin')
}

/** Environment every terminal gets, so `tezgah` works in it. */
export function cliEnv(paneId: string): Record<string, string> {
  return {
    TEZGAH_SOCKET: socketPath(),
    TEZGAH_PANE_ID: paneId,
    TEZGAH_ELECTRON: process.execPath,
    TEZGAH_CLI: path.join(binDir(), 'tezgah-cli.js'),
  }
}

/** An MCP config that gives a Claude Code session Tezgah's tools (passed with --mcp-config, so the
 *  user's own Claude settings are never touched). */
export function mcpConfigFile(paneId: string): string {
  if (!/^[\w-]{8,64}$/.test(paneId)) throw new Error('bad pane id')
  const dir = path.join(app.getPath('userData'), 'mcp')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${paneId}.json`)
  const env = cliEnv(paneId)
  const config = {
    mcpServers: {
      tezgah: {
        type: 'stdio',
        command: env.TEZGAH_ELECTRON,
        args: [env.TEZGAH_CLI, 'mcp'],
        env: { ELECTRON_RUN_AS_NODE: '1', TEZGAH_SOCKET: env.TEZGAH_SOCKET, TEZGAH_PANE_ID: paneId },
      },
    },
  }
  fs.writeFileSync(file, JSON.stringify(config, null, 2))
  return file
}

const pending = new Map<string, (res: { ok: boolean; result?: unknown; error?: string }) => void>()

export function startControl(target: () => WebContents | undefined): void {
  ipcMain.on('control-reply', (_e, id: string, res) => {
    pending.get(id)?.(res)
    pending.delete(id)
  })

  const file = socketPath()
  if (process.platform !== 'win32') fs.rmSync(file, { force: true })
  const server = net.createServer((conn) => {
    let buf = ''
    conn.setEncoding('utf8')
    conn.on('error', () => undefined)
    conn.on('data', (chunk) => {
      buf += chunk
      if (buf.length > 1 << 20) return conn.destroy()
      const nl = buf.indexOf('\n')
      if (nl < 0) return
      const line = buf.slice(0, nl)
      buf = ''
      let req: ControlRequest
      try {
        req = JSON.parse(line)
        if (typeof req.cmd !== 'string') throw new Error()
      } catch {
        return conn.end(JSON.stringify({ ok: false, error: 'bad request' }) + '\n')
      }
      const web = target()
      if (!web || web.isDestroyed()) return conn.end(JSON.stringify({ ok: false, error: 'Tezgah has no window open' }) + '\n')
      const id = randomUUID()
      const timer = setTimeout(() => {
        pending.delete(id)
        conn.end(JSON.stringify({ ok: false, error: 'timed out' }) + '\n')
      }, 130_000)
      pending.set(id, (res) => {
        clearTimeout(timer)
        conn.end(JSON.stringify(res) + '\n')
      })
      web.send('control', id, req)
    })
  })
  server.on('error', (e) => console.error('tezgah control socket:', e.message))
  server.listen(file, () => {
    // Only this user may talk to it.
    if (process.platform !== 'win32') fs.chmodSync(file, 0o600)
  })
  app.on('will-quit', () => {
    server.close()
    if (process.platform !== 'win32') fs.rmSync(file, { force: true })
  })
}
