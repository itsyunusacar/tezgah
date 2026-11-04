const T = window.__tezgah, A = T.actions
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
// A visible cursor, since screen recordings of the page don't include the system one.
const c = document.createElement('div')
c.innerHTML = '<svg width="22" height="28" viewBox="0 0 22 28"><path d="M2 2 L2 22 L7.5 17 L11 25 L14.5 23.5 L11 15.5 L18 15.5 Z" fill="#fff" stroke="#000" stroke-width="1.6" stroke-linejoin="round"/></svg>'
Object.assign(c.style, { position: 'fixed', left: '0px', top: '0px', zIndex: 9999, pointerEvents: 'none', transition: 'transform 0.7s cubic-bezier(.3,.7,.2,1)', transform: 'translate(900px, 500px)' })
document.body.appendChild(c)
const at = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2 - 3, r.top + r.height / 2 - 3] }
const move = async (el, ms = 800) => { const [x, y] = at(el); c.style.transform = `translate(${x}px, ${y}px)`; await wait(ms) }
const click = async (el) => { await move(el); c.animate([{ scale: 1 }, { scale: 0.82 }, { scale: 1 }], { duration: 180 }); await wait(140); el.click(); await wait(300) }
const titles = T.store.getState().ws.sessions.map((s) => s.title)
const row = (i) => [...document.querySelectorAll('.session-row')].find((r) => r.querySelector('.title')?.textContent.includes(titles[i]))

await wait(1600)
// Claude asks to run the tests: allow it from the sidebar.
await click(row(0).querySelector('.actions .primary'))
await wait(2600)
// Codex wants to apply a patch in another project.
await click(row(3))
await wait(1400)
await click(row(3).querySelector('.actions .primary'))
await wait(2200)
// Back to the first session, done; open the notifications.
await click(row(0))
await wait(1000)
await click(document.querySelector('.icon-btn.bell'))
await wait(2000)
document.querySelector('.scrim')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
await wait(600)
await move(row(1), 900)
await wait(900)
c.remove()
