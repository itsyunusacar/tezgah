// Renders docs/brand/*.html to PNG with Electron: electron docs/brand/render.cjs <page.html> <out.png> <w> <h> [query]
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const [page, out, w, h, query = ''] = process.argv.slice(2)
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: Number(w), height: Number(h), show: false, useContentSize: true, webPreferences: { offscreen: true } })
  await win.loadFile(path.resolve(page), { search: query })
  await new Promise((r) => setTimeout(r, 1200))
  const image = await win.webContents.capturePage()
  fs.writeFileSync(out, image.resize({ width: Number(w), height: Number(h), quality: 'best' }).toPNG())
  app.quit()
})
