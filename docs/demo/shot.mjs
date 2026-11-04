// Usage: node shot.mjs out.png — captures the Tezgah window's page.
import fs from 'node:fs'
const list = await (await fetch('http://localhost:9333/json')).json()
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }))
const res = await new Promise((r) => ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id === 1) r(m) }))
fs.writeFileSync(process.argv[2], Buffer.from(res.result.data, 'base64'))
ws.close()
