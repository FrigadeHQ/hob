import { BrowserWindow, session } from 'electron'

/**
 * Load a web page in a hidden, locked-down window and return its HTML once scripts have filled it in.
 * Separate session, no Node, sandboxed, no images; downloads and popups are refused.
 */
export async function renderPage(url: string, signal: AbortSignal, settleMs = 2500): Promise<string> {
  const ses = session.fromPartition('web-reader')
  ses.removeAllListeners('will-download')
  ses.on('will-download', (e) => e.preventDefault())
  const win = new BrowserWindow({
    show: false, width: 1280, height: 900,
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, images: false, webgl: false, offscreen: true },
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.setAudioMuted(true)
  const stop = () => { if (!win.isDestroyed()) win.destroy() }
  signal.addEventListener('abort', stop, { once: true })
  const timeout = setTimeout(stop, 20_000)
  try {
    await win.loadURL(url, { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36' })
    await new Promise((r) => setTimeout(r, settleMs))
    return await win.webContents.executeJavaScript('document.documentElement.outerHTML')
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', stop)
    stop()
  }
}
