// Usage: node record.mjs <outdir> <scenario.js>  — records the Tezgah window (CDP screencast) while the
// scenario (an async function body, run in the page) plays, writing frames and a timing list.
import fs from 'node:fs'
const [outdir, scenarioFile] = process.argv.slice(2)
fs.rmSync(outdir, { recursive: true, force: true })
fs.mkdirSync(outdir, { recursive: true })
const list = await (await fetch('http://localhost:9333/json')).json()
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0
const pending = new Map()
const frames = []
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) }
  if (m.method === 'Page.screencastFrame') {
    const n = frames.length
    fs.writeFileSync(`${outdir}/f${String(n).padStart(5, '0')}.jpg`, Buffer.from(m.params.data, 'base64'))
    frames.push(m.params.metadata.timestamp)
    send('Page.screencastFrameAck', { sessionId: m.params.sessionId })
  }
})
const send = (method, params = {}) => new Promise((r) => { const my = ++id; pending.set(my, r); ws.send(JSON.stringify({ id: my, method, params })) })
await send('Page.enable')
await send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 })
const body = fs.readFileSync(scenarioFile, 'utf8')
await send('Runtime.evaluate', { expression: `(async () => { ${body} })()`, awaitPromise: true })
await new Promise((r) => setTimeout(r, 400))
await send('Page.stopScreencast')
// ffmpeg concat list with each frame's duration.
let concat = ''
for (let i = 0; i < frames.length; i++) {
  const d = i + 1 < frames.length ? frames[i + 1] - frames[i] : 0.5
  concat += `file 'f${String(i).padStart(5, '0')}.jpg'\nduration ${Math.max(0.01, d).toFixed(3)}\n`
}
concat += `file 'f${String(frames.length - 1).padStart(5, '0')}.jpg'\n`
fs.writeFileSync(`${outdir}/frames.txt`, concat)
console.log(frames.length, 'frames,', (frames[frames.length - 1] - frames[0]).toFixed(1), 's')
ws.close()
