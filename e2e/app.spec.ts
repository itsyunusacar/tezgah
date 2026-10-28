import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// The app as someone uses it: a project, a shell, splits, the `tezgah` command, the browser, Turkish.
// Each test gets a fresh profile and project folder. Driving goes through the UI where it matters and
// through window.__tezgah (see main.tsx) to set things up.

const windows = process.platform === 'win32'
let app: ElectronApplication
let page: Page
let project: string

test.beforeEach(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tezgah-e2e-'))
  project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tezgah-project-')))
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ language: 'en', checkUpdates: false, notify: false, agentTools: false, introSeen: true }))
  app = await electron.launch({ args: ['.'], env: { ...process.env, TEZGAH_USER_DATA: profile } as Record<string, string> })
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

/** What a pane shows, polled until it matches. */
async function screen(pane: string, match: RegExp) {
  await expect
    .poll(() => page.evaluate((id) => (window as never as { __tezgah: any }).__tezgah.terminals.screenText(id, 200) as string, pane), { timeout: 20_000 })
    .toMatch(match)
}

test('starts empty and offers to open a folder', async () => {
  await expect(page.getByRole('button', { name: 'Open a Folder' })).toBeVisible()
})

test('runs commands in a shell session', async () => {
  const pane = await shell()
  await expect(page.locator('.session-row .title', { hasText: 'Shell' })).toBeVisible()
  await screen(pane, /\S/) // a prompt
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
  await screen(pane, /\S/)
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
  await screen(pane, /\S/)
  const html = `data:text/html,<button onclick="document.title='clicked-ok'">Go</button>`
  await type(pane, `tezgah browser open '${html}' && tezgah browser click text=Go && tezgah browser eval document.title`)
  await screen(pane, /clicked-ok/)
  await expect(page.locator('webview')).toHaveCount(1)
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
