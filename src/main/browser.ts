import { app, session, webContents, type WebContents } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Drives browser panes for agents: a text snapshot of the page with element refs, real (trusted)
// mouse and keyboard input, screenshots, waiting, and the page's console and network activity.

export const PARTITION = 'persist:browser'

interface LogEntry {
  at: number
  text: string
}
const consoles = new Map<number, LogEntry[]>()
const networks = new Map<number, { at: number; method: string; url: string; status?: number; error?: string; type: string }[]>()
const push = <T>(map: Map<number, T[]>, id: number, item: T, limit = 300) => {
  const list = map.get(id) ?? []
  list.push(item)
  if (list.length > limit) list.splice(0, list.length - limit)
  map.set(id, list)
}

/** Called for every webview as it is created. */
export function watch(contents: WebContents): void {
  const id = contents.id
  contents.on('console-message', (e: unknown, ...rest: unknown[]) => {
    // Electron passes one details object (new) or (level, message, line, source) (old).
    const d = e as { message?: string; level?: string | number; lineNumber?: number; sourceId?: string }
    const message = d.message ?? String(rest[1] ?? '')
    const level = d.level ?? rest[0]
    const name = typeof level === 'number' ? ['debug', 'info', 'warning', 'error'][level] ?? 'info' : String(level)
    if (message.startsWith('Electron Security Warning')) return // about Electron itself, not the page
    const where = d.sourceId ? ` (${d.sourceId.split('/').pop()}:${d.lineNumber})` : ''
    push(consoles, id, { at: Date.now(), text: `[${name}] ${message}${name === 'error' ? where : ''}` })
  })
  contents.on('render-process-gone', (_e, details) => push(consoles, id, { at: Date.now(), text: `[error] page crashed: ${details.reason}` }))
  contents.once('destroyed', () => {
    consoles.delete(id)
    networks.delete(id)
  })
}

let networkWatched = false
export function watchNetwork(): void {
  if (networkWatched) return
  networkWatched = true
  const s = session.fromPartition(PARTITION)
  s.webRequest.onCompleted((d) => {
    if (d.webContentsId) push(networks, d.webContentsId, { at: Date.now(), method: d.method, url: d.url, status: d.statusCode, type: d.resourceType })
  })
  s.webRequest.onErrorOccurred((d) => {
    if (d.webContentsId) push(networks, d.webContentsId, { at: Date.now(), method: d.method, url: d.url, error: d.error, type: d.resourceType })
  })
}

// Page scripts. They run in the page's main world, so they only use plain DOM.

const SNAPSHOT = `(() => {
  const opts = __OPTS__;
  document.querySelectorAll('[data-tz-ref]').forEach((e) => e.removeAttribute('data-tz-ref'));
  let n = 0;
  const lines = [];
  const LIMIT = opts.limit || 1200;
  const clip = (s, k) => { s = (s || '').replace(/\\s+/g, ' ').trim(); return s.length > k ? s.slice(0, k) + '…' : s; };
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) !== 0;
  };
  const inputRole = (t) => ({ checkbox: 'checkbox', radio: 'radio', range: 'slider', submit: 'button', button: 'button', reset: 'button', image: 'button', search: 'searchbox', file: 'file' })[t] || 'textbox';
  const role = (el) => {
    const r = el.getAttribute('role');
    if (r) return r;
    const t = el.tagName.toLowerCase();
    if (t === 'a' && el.hasAttribute('href')) return 'link';
    if (t === 'button' || t === 'summary') return 'button';
    if (t === 'input') return el.type === 'hidden' ? null : inputRole(el.type);
    if (t === 'select') return 'combobox';
    if (t === 'textarea') return 'textbox';
    if (/^h[1-6]$/.test(t)) return 'heading';
    if (t === 'img') return el.alt ? 'img' : null;
    if (el.isContentEditable && (!el.parentElement || !el.parentElement.isContentEditable)) return 'textbox';
    if (t === 'dialog' && el.open) return 'dialog';
    return null;
  };
  const INTERACTIVE = new Set(['link', 'button', 'checkbox', 'radio', 'slider', 'textbox', 'searchbox', 'combobox', 'file', 'tab', 'menuitem', 'option', 'switch', 'listbox', 'menuitemcheckbox', 'menuitemradio', 'treeitem', 'spinbutton']);
  const labelled = (el) => {
    const ids = el.getAttribute('aria-labelledby');
    if (ids) return ids.split(/\\s+/).map((i) => document.getElementById(i)?.innerText || '').join(' ');
    return '';
  };
  const name = (el) => clip(
    el.getAttribute('aria-label') || labelled(el) ||
    (el.labels && el.labels[0] && el.labels[0].innerText) ||
    el.getAttribute('alt') || el.getAttribute('title') ||
    (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) ? el.getAttribute('placeholder') || el.getAttribute('name') : el.innerText) || '',
    100);
  const clickable = (el) => {
    if (el.hasAttribute('onclick') || el.getAttribute('tabindex') === '0') return true;
    return getComputedStyle(el).cursor === 'pointer' && !(el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer');
  };
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'svg', 'HEAD', 'META', 'LINK']);
  const LANDMARK = { NAV: 'navigation', MAIN: 'main', FORM: 'form', HEADER: 'banner', FOOTER: 'contentinfo', ASIDE: 'complementary', TABLE: 'table', UL: 'list', OL: 'list' };
  const walk = (node, depth) => {
    if (lines.length >= LIMIT) return;
    for (const child of node.childNodes) {
      if (lines.length >= LIMIT) return;
      if (child.nodeType === 3) {
        if (opts.interactive) continue;
        const t = clip(child.textContent, 200);
        if (t.length > 1 && child.parentElement && !child.parentElement.closest('[data-tz-ref]')) lines.push('  '.repeat(depth) + '- text: ' + JSON.stringify(t));
        continue;
      }
      if (child.nodeType !== 1 || SKIP.has(child.tagName)) continue;
      const el = child;
      if (!shown(el) && el.tagName !== 'DETAILS') continue;
      let r = role(el);
      if (!r && clickable(el) && el.innerText && el.innerText.trim()) r = 'clickable';
      if (r && (!opts.interactive || INTERACTIVE.has(r) || r === 'clickable' || r === 'heading' || r === 'dialog')) {
        const ref = 'e' + (++n);
        el.setAttribute('data-tz-ref', ref);
        let line = '  '.repeat(depth) + '- ' + r + ' ' + JSON.stringify(name(el));
        if (r === 'heading') line += ' [level=' + (el.tagName[1] || el.getAttribute('aria-level') || '') + ']';
        if ('value' in el && ['textbox', 'searchbox', 'combobox', 'slider', 'spinbutton'].includes(r) && el.value) line += ' value=' + JSON.stringify(clip(String(el.value), 80));
        if (el.isContentEditable && r === 'textbox' && el.innerText.trim()) line += ' value=' + JSON.stringify(clip(el.innerText, 80));
        if ('checked' in el && (r === 'checkbox' || r === 'radio' || r === 'switch')) line += el.checked ? ' [checked]' : ' [unchecked]';
        if (el.getAttribute('aria-expanded')) line += ' [expanded=' + el.getAttribute('aria-expanded') + ']';
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') line += ' [disabled]';
        if (r === 'link') { const h = el.getAttribute('href') || ''; if (!h.startsWith('javascript:')) line += ' → ' + clip(h, 80); }
        lines.push(line + ' [ref=' + ref + ']');
        if (r === 'combobox' && el.tagName === 'SELECT') for (const o of el.options) lines.push('  '.repeat(depth + 1) + '- option ' + JSON.stringify(clip(o.text, 60)) + (o.selected ? ' [selected]' : ''));
        if (INTERACTIVE.has(r) || r === 'heading' || r === 'img' || r === 'clickable') continue;
        walk(el, depth + 1);
        continue;
      }
      const landmark = LANDMARK[el.tagName] || (['navigation', 'main', 'form', 'search', 'dialog', 'alert', 'region'].includes(el.getAttribute('role') || '') ? el.getAttribute('role') : null);
      if (landmark && !opts.interactive) {
        const label = el.getAttribute('aria-label');
        lines.push('  '.repeat(depth) + '- ' + landmark + (label ? ' ' + JSON.stringify(clip(label, 60)) : '') + ':');
        walk(el, depth + 1);
      } else walk(el.shadowRoot || el, depth);
      if (el.shadowRoot) walk(el, depth);
    }
  };
  walk(document.body || document.documentElement, 0);
  const head = 'Page: ' + document.title + '\\nURL: ' + location.href + '\\nScroll: ' + Math.round(scrollY) + '/' + Math.max(0, document.documentElement.scrollHeight - innerHeight) + 'px\\n';
  return head + lines.join('\\n') + (lines.length >= LIMIT ? '\\n… (cut at ' + LIMIT + ' lines; use --interactive)' : '');
})()`

/** Finds an element by ref ("e12"), CSS selector, or visible text ("text=Sign in"), scrolls it into view
 *  and returns where it is. */
const LOCATE = `((target) => {
  let el = null;
  const m = target.match(/^@?(e\\d+)$/);
  if (m) el = document.querySelector('[data-tz-ref="' + m[1] + '"]');
  else if (target.startsWith('text=')) {
    const want = target.slice(5).trim().toLowerCase();
    const all = [...document.querySelectorAll('a,button,input,label,summary,[role],[onclick],[tabindex],li,td,span,div,p,h1,h2,h3,h4,h5,h6')];
    const hits = all.filter((e) => {
      const r = e.getBoundingClientRect();
      const t = (e.innerText || e.value || e.getAttribute('aria-label') || '').trim().toLowerCase();
      return r.width > 0 && r.height > 0 && t.includes(want);
    });
    // Things you can act on first, then exact matches, then the tightest element around the text.
    const ACT = 'a,button,input,select,textarea,summary,label,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=checkbox],[onclick]';
    const score = (e) => {
      const t = (e.innerText || e.value || e.getAttribute('aria-label') || '').trim().toLowerCase();
      return (e.matches(ACT) ? 0 : 2) + (t === want ? 0 : 1);
    };
    hits.sort((a, b) => score(a) - score(b) || (a.innerText || '').length - (b.innerText || '').length);
    el = hits[0] || null;
  } else {
    try { el = document.querySelector(target); } catch (e) { return { error: 'bad selector' }; }
  }
  if (!el) return null;
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, top: r.top, width: r.width, height: r.height, tag: el.tagName.toLowerCase() };
})`

function wcFor(id: number): WebContents {
  const wc = webContents.fromId(id)
  if (!wc || wc.isDestroyed() || wc.getType() !== 'webview') throw new Error('the browser pane is gone')
  return wc
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function locate(wc: WebContents, target: string) {
  const box = await wc.executeJavaScript(`${LOCATE}(${JSON.stringify(target)})`)
  if (!box) throw new Error(`no element matches ${target}${/^@?e\d+$/.test(target) ? ' (refs change with every snapshot; take a new one)' : ''}`)
  if (box.error) throw new Error(box.error)
  return box as { x: number; y: number; left: number; top: number; width: number; height: number; tag: string }
}

// Keyboard: names agents use ("Enter", "ArrowDown", "Control+a") → Electron key codes.
const KEYS: Record<string, string> = {
  enter: 'Enter', return: 'Enter', tab: 'Tab', escape: 'Escape', esc: 'Escape', backspace: 'Backspace', delete: 'Delete', space: 'Space',
  arrowup: 'Up', arrowdown: 'Down', arrowleft: 'Left', arrowright: 'Right', up: 'Up', down: 'Down', left: 'Left', right: 'Right',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown',
}
const MODS: Record<string, 'control' | 'shift' | 'alt' | 'meta'> = { control: 'control', ctrl: 'control', shift: 'shift', alt: 'alt', option: 'alt', meta: 'meta', cmd: 'meta', command: 'meta' }

function press(wc: WebContents, combo: string): void {
  const parts = combo.split('+').map((p) => p.trim()).filter(Boolean)
  const key = parts.pop() ?? ''
  const modifiers = parts.map((p) => MODS[p.toLowerCase()]).filter(Boolean)
  const keyCode = KEYS[key.toLowerCase()] ?? (key.length === 1 ? key : key)
  wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
  if (key.length === 1 && !modifiers.some((m) => m === 'control' || m === 'meta')) wc.sendInputEvent({ type: 'char', keyCode: key, modifiers })
  else if (keyCode === 'Enter' && !modifiers.length) wc.sendInputEvent({ type: 'char', keyCode: '\r' })
  wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
}

async function click(wc: WebContents, x: number, y: number, button: 'left' | 'right' = 'left', clickCount = 1) {
  wc.sendInputEvent({ type: 'mouseMove', x, y })
  for (let i = 1; i <= clickCount; i++) {
    wc.sendInputEvent({ type: 'mouseDown', x, y, button, clickCount: i })
    wc.sendInputEvent({ type: 'mouseUp', x, y, button, clickCount: i })
  }
}

function shotFile(): string {
  const dir = path.join(os.tmpdir(), 'tezgah-shots')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, `shot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`)
}

async function waitFor(wc: WebContents, check: () => Promise<boolean>, timeout: number, what: string) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await check().catch(() => false)) return
    await sleep(150)
  }
  throw new Error(`timed out after ${timeout} ms waiting for ${what}`)
}

/** Waits for the page to stop loading, then a short quiet moment for scripts to render. */
async function settle(wc: WebContents, timeout = 15000) {
  await waitFor(wc, async () => !wc.isLoading(), timeout, 'the page to load').catch(() => undefined)
  await sleep(150)
}

export type BrowserArgs = Record<string, unknown>

export async function act(id: number, action: string, args: BrowserArgs): Promise<unknown> {
  const wc = wcFor(id)
  const str = (k: string) => (typeof args[k] === 'string' ? (args[k] as string) : undefined)
  const target = () => {
    const t = str('target')
    if (!t) throw new Error('which element? pass a ref from a snapshot (e12), a CSS selector, or text=…')
    return t
  }
  switch (action) {
    case 'snapshot':
      await settle(wc, 5000)
      return wc.executeJavaScript(SNAPSHOT.replace('__OPTS__', JSON.stringify({ interactive: !!args.interactive, limit: Number(args.limit) || undefined })))
    case 'click': {
      const box = await locate(wc, target())
      await click(wc, box.x, box.y, args.right ? 'right' : 'left', args.double ? 2 : 1)
      await sleep(100)
      await settle(wc, 5000)
      return `clicked ${box.tag} at ${Math.round(box.x)},${Math.round(box.y)}`
    }
    case 'hover': {
      const box = await locate(wc, target())
      wc.sendInputEvent({ type: 'mouseMove', x: box.x, y: box.y })
      return `hovering ${box.tag}`
    }
    case 'fill': {
      const t = target()
      const box = await locate(wc, t)
      // Focus and select what's there, then type over it like a person would (frameworks see real input events).
      await click(wc, box.x, box.y)
      await wc.executeJavaScript(`(() => { const el = document.activeElement; if (!el) return;
        if (typeof el.select === 'function') el.select();
        else if (el.isContentEditable) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } })()`)
      const text = str('text') ?? ''
      if (text) await wc.insertText(text)
      else press(wc, 'Backspace')
      return `filled ${box.tag === 'label' ? 'the field for that label' : box.tag}`
    }
    case 'type':
      if (str('target')) {
        const box = await locate(wc, target())
        await click(wc, box.x, box.y)
      }
      await wc.insertText(str('text') ?? '')
      return true
    case 'press': {
      const keys = (str('key') ?? '').split(/\s+/).filter(Boolean)
      if (!keys.length) throw new Error('which key? e.g. Enter, Tab, Escape, ArrowDown, Control+a')
      for (const k of keys) {
        press(wc, k)
        await sleep(40)
      }
      await settle(wc, 3000)
      return true
    }
    case 'select': {
      const t = target()
      await locate(wc, t)
      const value = str('value') ?? ''
      const picked = await wc.executeJavaScript(`((target, value) => {
        const m = target.match(/^@?(e\\d+)$/);
        const el = m ? document.querySelector('[data-tz-ref="' + m[1] + '"]') : document.querySelector(target);
        if (!el || el.tagName !== 'SELECT') return null;
        const want = value.toLowerCase();
        const opt = [...el.options].find((o) => o.value === value || o.text.trim().toLowerCase() === want) || [...el.options].find((o) => o.text.toLowerCase().includes(want));
        if (!opt) return null;
        el.value = opt.value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return opt.text;
      })(${JSON.stringify(t)}, ${JSON.stringify(value)})`)
      if (picked === null) throw new Error(`no option "${value}" in ${t} (or it isn't a <select>)`)
      return `selected ${picked}`
    }
    case 'scroll': {
      if (str('target')) {
        await locate(wc, target())
        return true
      }
      const dir = str('direction') ?? 'down'
      const amount = Number(args.amount) || 0
      await wc.executeJavaScript(`(() => { const d = ${JSON.stringify(dir)}; const a = ${amount} || innerHeight * 0.8;
        if (d === 'top') scrollTo(0, 0); else if (d === 'bottom') scrollTo(0, document.documentElement.scrollHeight);
        else scrollBy(d === 'left' ? -a : d === 'right' ? a : 0, d === 'up' ? -a : d === 'down' ? a : 0); })()`)
      return true
    }
    case 'screenshot': {
      await settle(wc, 5000)
      let rect: Electron.Rectangle | undefined
      if (str('target')) {
        const box = await locate(wc, target())
        await sleep(50)
        rect = { x: Math.max(0, Math.floor(box.left)), y: Math.max(0, Math.floor(box.top)), width: Math.ceil(box.width), height: Math.ceil(box.height) }
      }
      const image = await Promise.race([
        wc.capturePage(rect, { stayHidden: true }),
        sleep(10000).then(() => {
          throw new Error('the page did not draw in time; is the window minimized?')
        }),
      ])
      if (image.isEmpty()) throw new Error('the page has nothing to show yet')
      const png = image.toPNG()
      const file = shotFile()
      fs.writeFileSync(file, png)
      const size = image.getSize()
      // For a model, a smaller image reads just as well and costs far less.
      const small = size.width > 1280 ? image.resize({ width: 1280, quality: 'good' }) : image
      return { path: file, width: size.width, height: size.height, ...(args.base64 ? { base64: small.toPNG().toString('base64') } : {}) }
    }
    case 'wait': {
      const timeout = Math.min(Number(args.timeout) || 10000, 120000)
      const text = str('text')
      const selector = str('selector')
      const url = str('url')
      const gone = str('gone')
      if (text) await waitFor(wc, () => wc.executeJavaScript(`(document.body?.innerText || '').includes(${JSON.stringify(text)})`), timeout, `text "${text}"`)
      else if (selector) await waitFor(wc, () => wc.executeJavaScript(`!!document.querySelector(${JSON.stringify(selector)})`), timeout, selector)
      else if (gone) await waitFor(wc, () => wc.executeJavaScript(`!(document.body?.innerText || '').includes(${JSON.stringify(gone)})`), timeout, `"${gone}" to go away`)
      else if (url) await waitFor(wc, async () => wc.getURL().includes(url), timeout, `the URL to contain ${url}`)
      else if (args.ms) await sleep(Math.min(Number(args.ms), 60000))
      else await settle(wc, timeout)
      return true
    }
    case 'console': {
      const list = consoles.get(id) ?? []
      const errors = !!args.errors
      const out = list.filter((e) => !errors || e.text.startsWith('[error]')).slice(-(Number(args.limit) || 100)).map((e) => e.text)
      if (args.clear) consoles.set(id, [])
      return out.length ? out.join('\n') : errors ? 'No errors.' : 'Nothing logged.'
    }
    case 'network': {
      const list = networks.get(id) ?? []
      const failed = !!args.failed
      const out = list
        .filter((r) => !failed || r.error || (r.status ?? 0) >= 400)
        .slice(-(Number(args.limit) || 100))
        .map((r) => `${r.error ? 'ERR ' + r.error : r.status} ${r.method} ${r.url.length > 160 ? r.url.slice(0, 160) + '…' : r.url}${r.type !== 'mainFrame' ? ` (${r.type})` : ''}`)
      if (args.clear) networks.set(id, [])
      return out.length ? out.join('\n') : failed ? 'No failed requests.' : 'No requests yet.'
    }
    case 'text':
      await settle(wc, 5000)
      return wc.executeJavaScript('document.body ? document.body.innerText : ""')
    case 'eval': {
      const script = str('script') ?? ''
      // Statements or an expression; the value comes back as JSON when it can.
      const value = await wc.executeJavaScript(`(async () => { return (${script}) })()`).catch(() => wc.executeJavaScript(`(async () => { ${script} })()`))
      return value === undefined ? 'undefined' : value
    }
    case 'info':
      return { url: wc.getURL(), title: wc.getTitle(), loading: wc.isLoading(), canGoBack: wc.navigationHistory.canGoBack() }
    case 'reload':
      wc.reload()
      await settle(wc)
      return true
    case 'back':
      wc.navigationHistory.goBack()
      await settle(wc)
      return wc.getURL()
    case 'forward':
      wc.navigationHistory.goForward()
      await settle(wc)
      return wc.getURL()
    case 'load':
      await settle(wc, Number(args.timeout) || 15000)
      return { url: wc.getURL(), title: wc.getTitle() }
  }
  throw new Error(`unknown browser action ${action}`)
}

app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() === 'webview') watch(contents)
})
