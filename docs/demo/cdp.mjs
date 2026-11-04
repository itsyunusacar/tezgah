// Usage: node cdp.mjs '<js expression>'  — evaluates in the Tezgah window and prints the result.
const list = await (await fetch('http://localhost:9333/json')).json()
const page = list.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0
const call = (method, params) => new Promise((resolve) => {
  const my = ++id
  const on = (ev) => { const m = JSON.parse(ev.data); if (m.id === my) { ws.removeEventListener('message', on); resolve(m.result) } }
  ws.addEventListener('message', on)
  ws.send(JSON.stringify({ id: my, method, params }))
})
const expr = process.argv[2]
const res = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
console.log(JSON.stringify(res.result?.value ?? res.exceptionDetails?.exception?.description ?? res, null, 1))
ws.close()
