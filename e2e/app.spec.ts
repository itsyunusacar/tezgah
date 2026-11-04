import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// The app as someone uses it: a project, a shell, splits, the `tezgah` command, the browser, Turkish.
// Each test gets a fresh profile and project folder. Driving goes through the UI where it matters and
// through window.__tezgah (see main.tsx) to set things up.

const windows = process.platform === 'win32'
let app: ElectronApplication
let page: Page
let project: string
let profile: string

test.beforeEach(async () => {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tezgah-e2e-'))
  project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tezgah-project-')))
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ language: 'en', checkUpdates: false, notify: false, agentTools: false, introSeen: true }))
  // Screen panes list made-up windows (main/screen.ts): nothing here may ask to record the real screen.
  app = await electron.launch({ args: ['.'], env: { ...process.env, TEZGAH_USER_DATA: profile, TEZGAH_FAKE_SCREENS: '1' } as Record<string, string> })
  page = await app.firstWindow()
  await page.waitForFunction(() => (window as never as { __tezgah?: unknown }).__tezgah !== undefined)
})

test.afterEach(async () => {
  await app.close()
})

/** Opens the project folder with one shell session and returns its pane id. */
async function shell(): Promise<string> {
  return page.evaluate((dir) => {
    const T = (window as never as { __tezgah: any }).__tezgah
    const p = T.actions.addProject(dir)
    return T.actions.newSession(p.id, 'shell').panes[0].id as string
  }, project)
}

/** Types a command line into a pane. */
const type = (pane: string, line: string) => page.evaluate(([id, text]) => window.tz.ptyWrite(id, text + '\r'), [pane, line])

/** What a pane shows, polled until it matches, also with its lines joined: a long prompt (CI machines
 *  have long host names) wraps what was typed after it onto the next line. */
async function screen(pane: string, match: RegExp) {
  const text = () => page.evaluate((id) => (window as never as { __tezgah: any }).__tezgah.terminals.screenText(id, 200) as string, pane)
  await expect
    .poll(async () => {
      const t = await text()
      return match.test(t) || match.test(t.replace(/\n/g, '')) ? 'matched' : t
    }, { timeout: 20_000 })
    .toBe('matched')
}

/** Waits for the shell's prompt: the screen ends in a prompt character and has stopped changing. Typing
 *  sooner lands in the shell while it still sets up its line editor, which garbles the keys. */
async function ready(pane: string) {
  let last = ''
  await expect
    .poll(async () => {
      const text = ((await page.evaluate((id) => (window as never as { __tezgah: any }).__tezgah.terminals.screenText(id, 200) as string, pane)) ?? '').trimEnd()
      const settled = text === last && text.length > 2 && /[%$#>❯]$/.test(text)
      last = text
      return settled
    }, { timeout: 20_000, intervals: [250] })
    .toBe(true)
}

test('starts empty and offers to open a folder', async () => {
  await expect(page.getByRole('button', { name: 'Open a Folder' })).toBeVisible()
})

test('runs commands in a shell session', async () => {
  const pane = await shell()
  await expect(page.locator('.session-row .title', { hasText: 'Shell' })).toBeVisible()
  await ready(pane)
  await type(pane, 'echo hello-$((40+2))')
  await screen(pane, /hello-42/)
})

test('splits panes and closes any of them', async () => {
  await shell()
  await page.getByTitle('Split right').first().click()
  await expect(page.locator('.pane')).toHaveCount(2)
  await page.locator('.pane-bar').nth(0).getByTitle(/Close pane/).click()
  await expect(page.locator('.pane')).toHaveCount(1)
})

test('the tezgah command sends a notification', async () => {
  test.skip(windows, 'shell quoting differs in PowerShell')
  const pane = await shell()
  await ready(pane)
  await type(pane, 'tezgah notify --title E2E all-done')
  await expect
    .poll(() => page.evaluate(() => (window as never as { __tezgah: any }).__tezgah.store.getState().notes.map((n: { body: string }) => n.body)))
    .toContain('all-done')
  await page.getByTitle(/Notifications/).click()
  await expect(page.locator('.note-item', { hasText: 'all-done' })).toBeVisible()
})

test('agents can drive the browser pane', async () => {
  test.skip(windows, 'shell quoting differs in PowerShell')
  const pane = await shell()
  await ready(pane)
  const html = `data:text/html,<button onclick="document.title='clicked-ok'">Go</button>`
  await type(pane, `tezgah browser open '${html}' && tezgah browser click text=Go && tezgah browser eval document.title`)
  await screen(pane, /clicked-ok/)
  await expect(page.locator('webview')).toHaveCount(1)
})

test('browser panes show local pages with their own files, but nothing outside their folder', async () => {
  test.skip(windows, 'shell quoting differs in PowerShell')
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  fs.mkdirSync(path.join(project, 'site', 'img'), { recursive: true })
  fs.writeFileSync(path.join(project, 'site', 'img', 'dot.png'), png)
  fs.writeFileSync(path.join(project, 'outside.png'), png)
  const page_ = path.join(project, 'site', 'page.html')
  fs.writeFileSync(page_, '<title>local-page</title><img src="img/dot.png"><img src="../outside.png"><img src="img/%2e%2e/%2e%2e/outside.png">')
  const pane = await shell()
  await ready(pane)
  await type(pane, `tezgah browser open '${pathToFileURL(page_).href}' && tezgah browser eval "document.title + '=' + [...document.images].map((i) => i.naturalWidth).join('')"`)
  await screen(pane, /local-page=100/)
  await type(pane, `tezgah browser eval "navigator.permissions.query({ name: 'geolocation' }).then((p) => 'geo-' + p.state)"`)
  await screen(pane, /geo-denied/)
})

test('pastes text, and copied images and files as paths', async () => {
  const pane = await shell()
  await ready(pane)
  const paste = () =>
    app.evaluate(({ Menu }) => {
      const find = (items: Electron.MenuItem[]): Electron.MenuItem | undefined =>
        items.map((i) => (i.label === 'Paste' ? i : i.submenu && find(i.submenu.items))).find(Boolean)
      find(Menu.getApplicationMenu()!.items)!.click()
    })
  const copied = () => page.evaluate(() => window.tz.clipboardPaste())

  await app.evaluate(({ clipboard }) => clipboard.writeText('https://example.com/pasted-link'))
  await paste()
  // A long prompt (CI machines have long host names) wraps the link; read it as one line.
  await expect
    .poll(() => page.evaluate((id) => ((window as never as { __tezgah: any }).__tezgah.terminals.screenText(id, 200) as string).replace(/\n/g, ''), pane))
    .toContain('https://example.com/pasted-link')

  await app.evaluate(async ({ clipboard, ClipboardItem }) => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })])
  })
  const image = await copied()
  expect(image.paths).toHaveLength(1)
  expect(fs.statSync(image.paths[0]).size).toBeGreaterThan(0)

  const file = path.join(project, 'notes.txt')
  fs.writeFileSync(file, 'hi')
  await app.evaluate(({ clipboard, ClipboardItem }, url) => clipboard.write([new ClipboardItem({ 'text/uri-list': url })]), pathToFileURL(file).href)
  expect((await copied()).paths).toEqual([file])
})

test('reads the path of a file given to the window (dropped files), sandboxed', async () => {
  const file = path.join(project, 'dropped file.txt')
  fs.writeFileSync(file, 'hi')
  await page.evaluate(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.id = 'e2e-file'
    document.body.append(input)
  })
  await page.setInputFiles('#e2e-file', file)
  const got = await page.evaluate(() => window.tz.pathForFile((document.getElementById('e2e-file') as HTMLInputElement).files![0]))
  expect(fs.realpathSync(got)).toBe(fs.realpathSync(file))
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()?.sandbox)).toBe(true)
})

test('shows the tour on first launch, and it can be skipped', async () => {
  await page.evaluate(() => (window as never as { __tezgah: any }).__tezgah.store.getState().setUI({ intro: true }))
  await expect(page.getByRole('heading', { name: 'Welcome to Tezgah' })).toBeVisible()
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByRole('heading', { name: 'Every agent at a glance' })).toBeVisible()
  await page.getByRole('button', { name: 'Skip' }).click()
  await expect(page.locator('.intro')).toHaveCount(0)
  expect(await page.evaluate(() => (window as never as { __tezgah: any }).__tezgah.store.getState().settings.introSeen)).toBe(true)
})

test('speaks Turkish', async () => {
  await page.evaluate(() => (window as never as { __tezgah: any }).__tezgah.store.getState().setSettings({ language: 'tr' }))
  await expect(page.getByRole('button', { name: 'Bir Klasör Aç' })).toBeVisible()
})

test('closing a session never selects an archived one', async () => {
  const ids = await page.evaluate((dir) => {
    const T = (window as never as { __tezgah: any }).__tezgah
    const p = T.actions.addProject(dir)
    const [a, b, c] = [0, 1, 2].map(() => T.actions.newSession(p.id, 'shell').id as string)
    T.actions.archiveSession(b)
    T.actions.select(a)
    T.actions.closeSession(a)
    return { b, c, selected: T.store.getState().ws.selectedSession as string }
  }, project)
  expect(ids.selected).toBe(ids.c)
  // Nor can anything select it behind the sidebar's back.
  await page.evaluate((b) => (window as never as { __tezgah: any }).__tezgah.actions.select(b), ids.b)
  expect(await page.evaluate(() => (window as never as { __tezgah: any }).__tezgah.store.getState().ws.selectedSession)).toBe(ids.c)
})

test('Shift+Return is a plain Return in a shell', async () => {
  test.skip(windows, 'no cat -v in PowerShell')
  const pane = await shell()
  await ready(pane)
  await type(pane, 'cat -v')
  await page.locator('.term-slot').click()
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.type('after')
  await page.keyboard.press('Enter')
  await screen(pane, /^after$/m)
  expect(await page.evaluate((id) => (window as never as { __tezgah: any }).__tezgah.terminals.screenText(id, 200) as string, pane)).not.toContain('^[')
})

test('Escape while recording a shortcut cancels only the recording', async () => {
  await page.evaluate(() => (window as never as { __tezgah: any }).__tezgah.store.getState().setUI({ shortcuts: true }))
  await page.locator('.shortcut-row .keys').first().click()
  await expect(page.getByText('Press keys…')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByText('Press keys…')).toHaveCount(0)
  await expect(page.locator('.dialog.shortcuts')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.dialog.shortcuts')).toHaveCount(0)
})

test('closing a dialog gives the keyboard back to the terminal', async () => {
  const pane = await shell()
  await ready(pane)
  const focused = () => page.evaluate(() => document.activeElement?.classList.contains('xterm-helper-textarea') ?? false)
  await expect.poll(focused).toBe(true)
  await page.evaluate(() => (window as never as { __tezgah: any }).__tezgah.store.getState().setUI({ palette: true }))
  await expect.poll(focused).toBe(false)
  await page.keyboard.press('Escape')
  await expect.poll(focused).toBe(true)
})

test('Return in a confirm dialog cancels instead of deleting a worktree', async () => {
  const { id, pane } = await page.evaluate((dir) => {
    const T = (window as never as { __tezgah: any }).__tezgah
    const p = T.actions.addProject(dir)
    const s = T.actions.newSession(p.id, 'shell', { branch: 'e2e', path: dir, base: 'main' })
    return { id: s.id as string, pane: s.panes[0].id as string }
  }, project)
  await ready(pane)
  await page.evaluate((sid) => (window as never as { __tezgah: any }).__tezgah.actions.closeSession(sid), id)
  await expect(page.getByRole('button', { name: 'Delete Worktree' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Delete Worktree' })).toHaveCount(0)
  expect(await page.evaluate((sid) => !!(window as never as { __tezgah: any }).__tezgah.actions.session(sid), id)).toBe(true)
})

/** A picture of the window for checking the look by eye, into the folder TEZGAH_SHOTS names (not compared). */
const shot = async (name: string) => {
  if (process.env.TEZGAH_SHOTS) await page.screenshot({ path: path.join(process.env.TEZGAH_SHOTS, `${name}.png`) })
}

/** The selected session's split tree as text, panes by kind: row(shell,col(shell,browser)). */
const shape = () =>
  page.evaluate(() => {
    const T = (window as never as { __tezgah: any }).__tezgah
    const s = T.actions.selected()
    const kind = (id: string) => s.panes.find((p: { id: string }) => p.id === id).kind
    const walk = (l: any): string => (l.type === 'pane' ? kind(l.paneId) : `${l.dir === 'row' ? 'row' : 'col'}(${l.children.map(walk).join(',')})`)
    return walk(s.layout)
  })

test('a pane dragged by its bar docks below another, and Escape cancels the drag', async () => {
  await shell()
  await page.evaluate(() => (window as never as { __tezgah: any }).__tezgah.actions.split('row'))
  await expect(page.locator('.pane')).toHaveCount(2)
  const drag = async (to: { x: number; y: number }) => {
    const from = (await page.locator('.pane-bar .label').nth(1).boundingBox())!
    await page.mouse.move(from.x + 10, from.y + 8)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 10 })
  }
  const target = (await page.locator('.pane').nth(0).boundingBox())!
  const below = { x: target.x + target.width / 2, y: target.y + target.height - 30 }

  await drag(below)
  await expect(page.locator('.dock-hint')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.dock-sheet')).toHaveCount(0)
  await page.mouse.up()
  expect(await shape()).toBe('row(shell,shell)')

  await drag(below)
  await expect(page.locator('.dock-ghost')).toHaveText('Below')
  await shot('layout-drag-dock')
  await page.mouse.up()
  expect(await shape()).toBe('col(shell,shell)')
})

test('a browser moved below its terminal opens below next time', async () => {
  await shell()
  await page.evaluate(() => (window as never as { __tezgah: any }).__tezgah.actions.openBrowser('about:blank'))
  await expect(page.locator('webview')).toHaveCount(1)
  expect(await shape()).toBe('row(shell,browser)')
  // From the pane's menu, as from the keyboard (⌃⌘↓).
  await page.locator('.browser-bar .grip').click()
  await expect(page.getByRole('menuitem', { name: /Move Right/ })).toBeDisabled()
  await shot('layout-browser-menu')
  await page.getByRole('menuitem', { name: /Move Down/ }).click()
  expect(await shape()).toBe('col(shell,browser)')
  await shot('layout-browser-below')

  await page.evaluate((dir) => {
    const T = (window as never as { __tezgah: any }).__tezgah
    T.actions.newSession(T.actions.addProject(dir).id, 'shell')
    T.actions.openBrowser('about:blank')
  }, project)
  await expect.poll(shape).toBe('col(shell,browser)')
})

/** The selected session's screen pane: its id and what it shows. */
const screenPane = () =>
  page.evaluate(() => {
    const T = (window as never as { __tezgah: any }).__tezgah
    const s = T.actions.selected()
    const p = s.panes.find((x: { kind: string }) => x.kind === 'screen')
    return { session: s.id as string, id: p.id as string, screen: p.screen }
  })

const showOnScreen = (screen: object) =>
  page.evaluate(async (screen) => {
    const T = (window as never as { __tezgah: any }).__tezgah
    const s = T.actions.selected()
    const p = s.panes.find((x: { kind: string }) => x.kind === 'screen')
    T.actions.updatePane(s.id, p.id, { screen })
  }, screen)

test('a screen pane shows the window picked for it, live, and finds it again by name', async () => {
  await shell()
  await page.evaluate(() => (window as never as { __tezgah: any }).__tezgah.actions.openScreen())
  await expect(page.locator('.screen-picker')).toBeVisible()
  await expect(page.locator('.screen-picker .source')).toHaveCount(3)
  await shot('screen-picker')
  await page.locator('.screen-picker .source', { hasText: 'Unity' }).click()
  await expect(page.locator('.screen-picker')).toHaveCount(0)
  expect(await shape()).toBe('row(shell,screen)')
  const video = page.locator('.pane.screen video')
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(0)
  await expect(page.locator('.pane.screen .pane-bar .name')).toHaveText('Unity · SampleScene - Unity 6')
  await shot('screen-pane')

  await page.locator('.pane.screen').getByTitle('Pause').click()
  await expect(page.locator('.pane.screen .pane-bar .msg')).toHaveText('Paused')
  await page.locator('.pane.screen').getByTitle('Resume').click()

  // After a relaunch the window has a new id and maybe a new title: the same app's window is found.
  await showOnScreen({ kind: 'window', name: 'Level2 - Unity 6', app: 'Unity' })
  await expect.poll(async () => (await screenPane()).screen).toEqual({ id: 'fake:window:1', kind: 'window', name: 'SampleScene - Unity 6', app: 'Unity' })

  // One that isn't open waits for it.
  await showOnScreen({ kind: 'window', name: 'Untitled', app: 'Blender' })
  await expect(page.locator('.screen-state')).toContainText('Waiting for Blender · Untitled')
  await shot('screen-waiting')
})

test('without permission to record the screen, the picker says how to allow it', async () => {
  await app.evaluate(() => void (process.env.TEZGAH_FAKE_SCREENS = 'denied'))
  await shell()
  await page.evaluate(() => (window as never as { __tezgah: any }).__tezgah.actions.openScreen())
  await expect(page.locator('.screen-picker .permission')).toBeVisible()
  await shot('screen-permission')
  await page.keyboard.press('Escape')
  await expect(page.locator('.screen-picker')).toHaveCount(0)
  await expect(page.locator('.pane.screen .screen-state')).toContainText('Watch a window live')
})

// Records the real screen, so only when asked (TEZGAH_E2E_LIVE_SCREEN=1) and already allowed: never puts
// up the system's question on a test machine.
test('a screen pane shows a real display', async () => {
  test.skip(!process.env.TEZGAH_E2E_LIVE_SCREEN, 'records the real screen; set TEZGAH_E2E_LIVE_SCREEN=1')
  await app.evaluate(() => void delete process.env.TEZGAH_FAKE_SCREENS)
  test.skip((await page.evaluate(() => window.tz.screenAccess())) !== 'granted', 'not allowed to record the screen here')
  const displays = (await page.evaluate(() => window.tz.screenSources(false))).filter((s) => s.kind === 'screen')
  expect(displays.length).toBeGreaterThan(0)
  await shell()
  await page.evaluate((s) => (window as never as { __tezgah: any }).__tezgah.actions.openScreen(undefined, { id: s.id, kind: s.kind, name: s.name }), displays[0])
  await expect.poll(() => page.locator('.pane.screen video').evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 20_000 }).toBeGreaterThan(0)
})

test('plan limits open a card with reset times and how fresh they are', async () => {
  await page.evaluate(() => {
    const T = (window as never as { __tezgah: any }).__tezgah
    const now = Date.now()
    const usage = [
      { id: 'claude', name: 'Claude', plan: 'Max', asOf: now - 60_000, live: true, limits: [
        { label: '5-hour', percent: 34, resetsAt: now + (2 * 60 + 14) * 60_000 + 30_000, windowMinutes: 300 },
        { label: 'Weekly', percent: 21, resetsAt: now + 3 * 86_400_000, windowMinutes: 10080 },
        { label: 'Weekly · Fable', percent: 76, resetsAt: now + 3 * 86_400_000, windowMinutes: 10080 },
      ] },
      { id: 'codex', name: 'Codex', plan: 'Plus', asOf: now - 3 * 3_600_000, live: false, limits: [
        { label: '5-hour', percent: 12, resetsAt: now + 3_600_000, windowMinutes: 300 },
      ] },
    ]
    // The app's own refresh would put the real numbers back.
    T.store.setState({ usage })
    T.store.subscribe((s: { usage: unknown }) => s.usage !== usage && T.store.setState({ usage }))
  })
  // Only one agent's limits at a time: Claude's, unless the selected session runs another agent.
  await expect(page.locator('.limit')).toHaveCount(3)
  await expect(page.locator('.limits [title]')).toHaveCount(0)
  const card = page.locator('.limits-card')
  // The app's first real answer may still land and move the meters under the pointer: hover again then.
  await expect(async () => {
    await page.mouse.move(600, 20)
    await page.locator('.limits').hover()
    await expect(card).toBeVisible({ timeout: 1000 })
  }).toPass()
  await expect(card).toContainText('34% used')
  await expect(card).toContainText('in 2h 14m')
  await expect(card).toContainText('Updated 1m ago')
  await expect(card).not.toContainText('Codex')
  const box = (await card.boundingBox())!
  const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(size.width)
  await shot('limits-card')
  await page.mouse.move(600, 20)
  await expect(card).toHaveCount(0)
  // From the keyboard too.
  await page.locator('.limits').focus()
  await expect(card).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(card).toHaveCount(0)
  await page.evaluate(() => (window as never as { __tezgah: any }).__tezgah.store.getState().setSettings({ theme: 'dark' }))
  await page.locator('.limits').blur()
  await page.locator('.limits').focus()
  await expect(card).toBeVisible()
  await shot('limits-card-dark')
  await page.keyboard.press('Escape')

  // A session running Codex shows Codex's.
  const pane = await shell()
  await page.evaluate((id) => (window as never as { __tezgah: any }).__tezgah.store.getState().setPane(id, { records: [{ id: '', state: 'working', app: 'codex' }] }), pane)
  await expect(page.locator('.limit')).toHaveCount(1)
  await expect(page.locator('.limits .provider-head .name')).toHaveText('Codex')
})

/** The middle of a cell inside the first place `text` shows on a pane's screen, in window coordinates. */
async function cellOf(pane: string, text: string) {
  return page.evaluate(([id, needle]) => {
    const T = (window as never as { __tezgah: any }).__tezgah
    const lines = (T.terminals.screenText(id, 200) as string).split('\n')
    const row = lines.findIndex((l) => l.includes(needle))
    const r = T.terminals.cellRect(id, lines[row].indexOf(needle) + 2, row)
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }, [pane, text] as const)
}

test('right-click on a terminal copies, pastes and selects', async () => {
  const pane = await shell()
  await ready(pane)
  await type(pane, 'echo copy-$((6*7))')
  await screen(pane, /copy-42/)
  const menu = page.locator('.menu')
  const rightClick = () => page.locator('.term-slot').click({ button: 'right', position: { x: 300, y: 200 } })
  await rightClick()
  await expect(menu.getByRole('menuitem', { name: /^Copy/ })).toBeDisabled()
  await expect(menu.getByRole('menuitem', { name: /^Paste/ })).toBeEnabled()
  await menu.getByRole('menuitem', { name: /^Select All/ }).click()
  // The selection survives the next right-click, for Copy.
  await rightClick()
  await expect(menu.getByRole('menuitem', { name: /^Copy/ })).toBeEnabled()
  await shot('terminal-menu')
  await menu.getByRole('menuitem', { name: /^Copy/ }).click()
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toContain('copy-42')

  await app.evaluate(({ clipboard }) => clipboard.writeText('pasted-by-menu'))
  await rightClick()
  await menu.getByRole('menuitem', { name: /^Paste/ }).click()
  await screen(pane, /pasted-by-menu/)
})

test('links in a terminal open with a click, or from the right-click menu', async () => {
  test.skip(windows, 'shell quoting differs in PowerShell')
  // Nothing really opens: the browser call is caught.
  await app.evaluate(({ shell }) => {
    const g = globalThis as never as { opened: string[] }
    g.opened = []
    shell.openExternal = async (url: string) => void g.opened.push(url)
  })
  const opened = () => app.evaluate(() => (globalThis as never as { opened: string[] }).opened)
  const pane = await shell()
  await ready(pane)
  await type(pane, "clear; printf 'see https://example.com/e2e-link and \\033]8;;https://example.com/osc8\\033\\\\named link\\033]8;;\\033\\\\ end\\n'")
  await screen(pane, /named link end/)

  // Over a link: xterm finds it as the pointer moves, once the text is drawn.
  const hover = (p: { x: number; y: number }, hint: string | RegExp) =>
    expect(async () => {
      await page.mouse.move(p.x, p.y + 60)
      await page.mouse.move(p.x, p.y, { steps: 3 })
      await expect(page.locator('.link-hint')).toContainText(hint, { timeout: 1000 })
    }).toPass()
  const at = await cellOf(pane, 'https://example.com/e2e-link')
  await hover(at, 'Click to open')
  await shot('terminal-link-hover')
  await page.mouse.click(at.x, at.y)
  await expect.poll(opened).toEqual(['https://example.com/e2e-link'])

  // A drag that selects text ending on a link doesn't open it.
  await page.mouse.move(at.x + 60, at.y)
  await page.mouse.down()
  await page.mouse.move(at.x, at.y, { steps: 5 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  expect(await opened()).toHaveLength(1)

  // An OSC 8 link (text that names its address) too.
  const named = await cellOf(pane, 'named link')
  await page.mouse.click(named.x, named.y + 80)
  await hover(named, 'https://example.com/osc8')
  await page.mouse.click(named.x, named.y)
  await expect.poll(opened).toEqual(['https://example.com/e2e-link', 'https://example.com/osc8'])

  await hover(at, 'Click to open')
  await page.mouse.click(at.x, at.y, { button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Copy Link' })).toBeVisible()
  await shot('terminal-link-menu')
  await page.getByRole('menuitem', { name: 'Open in Browser Pane' }).click()
  await expect
    .poll(() => page.evaluate(() => (window as never as { __tezgah: any }).__tezgah.actions.selected().panes.map((p: { url?: string }) => p.url ?? '')))
    .toContain('https://example.com/e2e-link')
  expect(await opened()).toHaveLength(2)
})

/** Clicks an item of the app's menu bar by its label. */
const menuItem = (label: string) =>
  app.evaluate(({ Menu }, name) => {
    const find = (items: Electron.MenuItem[]): Electron.MenuItem | undefined =>
      items.map((i) => (i.label === name ? i : i.submenu && find(i.submenu.items))).find(Boolean)
    find(Menu.getApplicationMenu()!.items)!.click()
  }, label)

test('throwaway terminals open in the home folder, outside any project', async () => {
  test.skip(windows, 'no sleep in PowerShell')
  await page.evaluate((dir) => (window as never as { __tezgah: any }).__tezgah.actions.addProject(dir), project)
  await page.getByTitle('New…').click()
  await page.getByRole('menuitem', { name: /^New Terminal(?! Pane)/ }).click()
  const rows = page.locator('.terminals .session-row')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('Terminal')
  await expect(page.locator('.header .status')).toHaveText('Terminal in your home folder')
  const pane = () => page.evaluate(() => (window as never as { __tezgah: any }).__tezgah.actions.selected().panes[0].id as string)
  const first = await pane()
  await screen(first, /\S/)
  await type(first, 'pwd')
  await screen(first, new RegExp(`^${os.homedir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'))

  await menuItem('New Terminal')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(1)).toContainText('Terminal 2')
  const second = await pane()
  await screen(second, /\S/)
  await shot('terminals-sidebar')

  // They're kept like other sessions.
  const saved = () => {
    try {
      return JSON.parse(fs.readFileSync(path.join(profile, 'workspace.json'), 'utf8')).sessions.filter((s: { projectId: string }) => s.projectId === '').length
    } catch {
      return 0 // not written yet
    }
  }
  await expect.poll(saved).toBe(2)

  // Something running: closing asks first.
  await type(second, 'sleep 60')
  await page.waitForTimeout(500)
  await rows.nth(1).hover()
  await rows.nth(1).getByTitle('Close session').click()
  await expect(page.locator('.dialog')).toContainText('sleep is still running in it')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(rows).toHaveCount(2)

  // At a prompt: it just closes.
  await rows.nth(0).hover()
  await rows.nth(0).getByTitle('Close session').click()
  await expect(rows).toHaveCount(1)
  await expect(page.locator('.dialog')).toHaveCount(0)
})

test('the sidebar finds projects and sessions as you type', async () => {
  const ids = await page.evaluate((dir) => {
    const T = (window as never as { __tezgah: any }).__tezgah
    const made: Record<string, string> = {}
    for (const [folder, titles] of [['Çalışma Alanı', ['Giriş düzeltmesi']], ['api', ['fix login', 'docs']], ['web', []]] as const) {
      const p = T.actions.addProject(`${dir}/${folder}`)
      for (const title of titles) {
        const s = T.actions.newSession(p.id, 'shell')
        T.actions.retitle(s.id, title)
        made[title] = s.id
      }
    }
    return made
  }, project)
  const field = page.getByPlaceholder('Find a project or session')
  const list = page.locator('.sidebar-list')
  await field.fill('calisma')
  await expect(list.locator('.project-row')).toHaveText(['Çalışma Alanı'])
  await expect(list.locator('.session-row')).toHaveText([/Giriş düzeltmesi/])
  await field.fill('LOGIN')
  await expect(list.locator('.project-row')).toHaveText(['api'])
  await expect(list.locator('.session-row')).toHaveText([/fix login/])
  await shot('sidebar-search')
  await field.press('Enter')
  await expect(field).toHaveValue('')
  expect(await page.evaluate(() => (window as never as { __tezgah: any }).__tezgah.store.getState().ws.selectedSession)).toBe(ids['fix login'])

  await field.fill('nothing-like-this')
  await expect(list).toContainText('No project or session matches')
  await field.press('Escape')
  await expect(field).toHaveValue('')
  await expect(list.locator('.project-row')).toHaveCount(3)

  // The quick switcher lists projects too: one goes to its first session.
  await page.evaluate((id) => (window as never as { __tezgah: any }).__tezgah.actions.select(id), ids['Giriş düzeltmesi'])
  await page.evaluate(() => (window as never as { __tezgah: any }).__tezgah.store.getState().setUI({ palette: true }))
  await page.keyboard.type('api')
  await page.locator('.dialog .item', { hasText: 'Project' }).click()
  await expect.poll(() => page.evaluate(() => (window as never as { __tezgah: any }).__tezgah.store.getState().ws.selectedSession)).toBe(ids['fix login'])
})
