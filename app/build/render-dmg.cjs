// The disk image's window background from dmg-background.svg (Electron's Chromium, no extra tools).
// Run once per size: electron build/render-dmg.cjs 1  →  background.png; 2 → background@2x.png
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')
const scale = Number(process.argv.at(-1)) === 2 ? 2 : 1
const w = 660 * scale, h = 400 * scale
const svg = fs.readFileSync(path.join(__dirname, 'dmg-background.svg'), 'utf8').replace('width="660" height="400"', `width="${w}" height="${h}"`)
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: w, height: h, show: false, frame: false, webPreferences: { offscreen: true } })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<html><body style="margin:0">${svg}</body></html>`))
  await new Promise((r) => setTimeout(r, 400))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: w, height: h })
  fs.writeFileSync(path.join(__dirname, scale === 2 ? 'background@2x.png' : 'background.png'), img.resize({ width: w, height: h }).toPNG())
  app.quit()
})
