// Renders an SVG to a 1024px PNG with Electron's Chromium (no extra tools needed).
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const [svgPath, outPath] = process.argv.slice(-2)
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } })
  const svg = fs.readFileSync(svgPath, 'utf8')
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`))
  await new Promise((r) => setTimeout(r, 500))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 })
  fs.writeFileSync(outPath, img.resize({ width: 1024, height: 1024 }).toPNG())
  app.quit()
})
