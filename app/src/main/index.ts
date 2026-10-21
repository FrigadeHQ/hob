import { app, BrowserWindow, protocol, safeStorage, session, shell } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import bundledCatalog from '../../../catalog/catalog.json'
import licenses from '../../../catalog/licenses.json'
import { makePaths } from './paths'
import { UtilityEngine } from './engine'
import { FakeEngine, fakeDownloadDeps } from './fake'
import { realDeps } from './downloader'
import { CATALOG_URL, loadCatalog } from './catalog'
import { readSysInfo, toHardware } from './hardware'
import { SetupController } from './setup'
import { registerIpc } from './ipc'
import { Store } from './store'
import { migrateFilesDir, migrateProfile } from './migrate'
import { pruneUndo } from './agent/journal'
import { PythonRuntime, realRuntimeDeps } from './python/runtime'
import { VisionInstaller } from './vision/install'
import { VisionServer } from './vision/server'
import { visionFitsGpu } from './vision/catalog'
import type { VisionState } from '../shared/types'
import os from 'node:os'
import { loadSettings, updateSettings, webAccessOn } from './settings'
import { PluginRegistry } from './plugins/registry'
import { loginPath } from './plugins/shellPath'
import { coreTools, nativeTools } from './tools'
import { isInside } from './workspace'
import { SearxngServer, type SearchResult } from './search/searxng'
import { SpeechModel } from './speech'

const FAKE = process.env.HOB_FAKE === '1'
// One profile folder however Hob is started (dev, packaged, tests): ~/Library/Application Support/Hob etc.
app.setName('Hob')
// renamed from Thrum: carry an existing profile (models, chats, settings) over once
if (!process.env.HOB_USER_DATA) migrateProfile(app.getPath('appData'))
app.setPath('userData', process.env.HOB_USER_DATA ?? join(app.getPath('appData'), 'Hob'))

// One Hob at a time: a second launch focuses the existing window instead of
// starting a second engine and a second download.
if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => {
  if (!win) return
  if (BACKGROUND) return
  if (win.isMinimized()) win.restore()
  win.focus()
})

/** Links in replies open in the user's browser, never inside the app window. */
function openExternally(url: string) {
  if (!FAKE && /^https?:\/\//.test(url)) void shell.openExternal(url)
}

let win: BrowserWindow | undefined
/** test runs: no window on screen, no Dock icon, never takes focus from what the person is doing */
const BACKGROUND = process.env.HOB_BACKGROUND === '1'

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', json: 'application/json' }
const mimeOf = (p: string) => MIME[p.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream'

// shows images the agent made, from chat folders and granted folders only
protocol.registerSchemesAsPrivileged([{ scheme: 'hob-file', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])

function createWindow() {
  win = new BrowserWindow({
    width: 1100, height: 760, minWidth: 720, minHeight: 520,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    // window buttons centred on the sidebar toggle (top-2, 32px tall: centre at 24px)
    trafficLightPosition: { x: 16, y: 17 },
    backgroundColor: '#fafaf9',
    show: !BACKGROUND,
    // hidden pages would otherwise pause timers and animations
    webPreferences: { preload: join(__dirname, '../preload/index.cjs'), sandbox: false, ...(BACKGROUND ? { backgroundThrottling: false } : {}) },
  })
  win.webContents.setWindowOpenHandler(({ url }) => { openExternally(url); return { action: 'deny' } })
  win.webContents.on('will-navigate', (e, url) => {
    // a file dropped outside the composer must never replace the app (file://…/sales.csv)
    const ownPage = process.env.ELECTRON_RENDERER_URL ? url.startsWith(process.env.ELECTRON_RENDERER_URL) : url === pathToFileURL(join(__dirname, '../renderer/index.html')).toString()
    if (ownPage) return
    e.preventDefault()
    openExternally(url)
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
  win.on('closed', () => { win = undefined })
}

// .mcpb bundles and plugin zips opened from Finder (this can arrive before the app is ready)
let openPluginFile: ((path: string) => Promise<void>) | undefined
const openedFiles: string[] = []
app.on('open-file', (e, path) => {
  e.preventDefault()
  if (openPluginFile) void openPluginFile(path)
  else openedFiles.push(path)
})

app.whenReady().then(() => {
  const paths = makePaths(app.getPath('userData'))
  const engine = FAKE ? new FakeEngine() : new UtilityEngine(join(__dirname, 'engine.js'))
  const setup = new SetupController({
    engine,
    modelsDir: paths.models,
    settingsPath: paths.settings,
    download: FAKE ? fakeDownloadDeps({ stepMs: Number(process.env.HOB_FAKE_STEP_MS) || undefined, freeDiskGB: Number(process.env.HOB_FAKE_FREE_GB) || undefined }) : realDeps,
    sha256Override: FAKE ? 'FAKE' : undefined,
    getHardware: FAKE
      ? async () => ({ os: 'darwin' as const, arch: 'arm64', cpuModel: 'Apple M1 Max', totalRamGB: 32, freeDiskGB: Number(process.env.HOB_FAKE_FREE_GB) || 500, gpu: { kind: 'unified' as const, name: 'Apple M1 Max', vramGB: 24 } })
      : async () => toHardware(await engine.probe(), await readSysInfo(paths.models)),
    getCatalog: () => loadCatalog({ url: CATALOG_URL, cachePath: paths.catalogCache, bundled: bundledCatalog, licenses, fetchFn: FAKE ? (async () => { throw new Error('offline') }) as unknown as typeof fetch : undefined }),
  })
  const store = new Store(paths.db)
  pruneUndo(paths.undo, { olderThanDays: 30 })
  const python = FAKE ? undefined : new PythonRuntime(paths.python, realRuntimeDeps)
  // E2E / custom profiles keep chat files inside the profile, never in the real Documents
  if (!process.env.HOB_USER_DATA && !loadSettings(paths.settings).filesDir) {
    migrateFilesDir(join(app.getPath('documents'), 'Thrum'), join(app.getPath('documents'), 'Hob'), store)
  }
  const filesDir = () => loadSettings(paths.settings).filesDir ?? (process.env.HOB_USER_DATA ? join(paths.root, 'Files') : join(app.getPath('documents'), 'Hob'))
  const speech = new SpeechModel(paths.speech, realRuntimeDeps)
  const allowed = (p: string) => isInside(filesDir(), p) || isInside(paths.speech, p) || store.listChats().some((c) => isInside(c.dir, p)) || store.knownFolders().some((g) => isInside(g, p))
  protocol.handle('hob-file', async (req) => {
    const p = decodeURIComponent(new URL(req.url).pathname.slice(1))
    if (!allowed(p)) return new Response('Not allowed', { status: 403 })
    // whole-file read: streaming through net.fetch ran at ~9 MB/s, which made the first dictation take 25 s
    try {
      const body = await readFile(p)
      // the dictation worker fetches model files from here; only Hob's own pages can reach this scheme
      return new Response(body, { headers: { 'content-type': mimeOf(p), 'content-length': String(body.length), 'access-control-allow-origin': '*' } })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
  // web search: SearXNG on this computer (needs the code tools); canned results in fake mode
  const searx = python ? new SearxngServer({ python: python.python, runtimeRoot: python.dir, settingsDir: paths.runTmp }) : undefined
  const search = FAKE
    ? async (q: string): Promise<SearchResult[]> => [{ title: `Lisbon: results for ${q}`, url: 'https://example.com/lisbon', snippet: 'Sunny, 24°C.' }]
    : async (q: string, signal: AbortSignal) => { await python!.ensure(); return searx!.search(q, signal) }
  app.on('before-quit', () => searx?.stop())
  // microphone for dictation; nothing else (camera, screen) is ever granted
  const audioOnly = (types?: string[]) => !!types?.length && types.every((t) => t === 'audio')
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb, details) => cb(permission === 'media' && audioOnly((details as { mediaTypes?: string[] }).mediaTypes)))
  session.defaultSession.setPermissionCheckHandler((_wc, permission, _origin, details) => permission === 'media' && (details as { mediaType?: string }).mediaType === 'audio')
  // secret plugin settings (API keys) are encrypted with the OS keychain. Asked only when a secret is used:
  // on macOS the first keychain access can show a system prompt, which must never block startup
  const canEncrypt = () => !FAKE && safeStorage.isEncryptionAvailable()
  const native = nativeTools()
  const plugins = new PluginRegistry({
    builtinDir: app.isPackaged ? join(process.resourcesPath, 'plugins') : join(__dirname, '../../plugins'),
    installDir: paths.plugins, store, native,
    reserved: [...coreTools().map((t) => t.spec.name), ...Object.keys(native), 'use_skill', 'save_skill'],
    // the Web search plugin's switch is the "Web access" setting
    bound: { web: { get: () => webAccessOn(loadSettings(paths.settings)), set: (on) => { updateSettings(paths.settings, { webAccess: on }) } } },
    crypt: {
      encrypt: (v) => (canEncrypt() ? `enc:${safeStorage.encryptString(v).toString('base64')}` : `plain:${v}`),
      decrypt: (v) => (v.startsWith('enc:') ? safeStorage.decryptString(Buffer.from(v.slice(4), 'base64')) : v.replace(/^plain:/, '')),
    },
    path: loginPath,
    // sign-in pages for online connectors open in the user's browser
    // (fake mode, for tests: follow the sign-in page's redirect straight back, like a browser that's already signed in)
    openExternal: FAKE
      ? async (url) => { const r = await fetch(url, { redirect: 'manual' }); const back = r.headers.get('location'); if (back) await fetch(back) }
      : (url) => { if (/^https?:\/\//i.test(url)) return shell.openExternal(url) },
    // bundles made for Node run on Electron's Node, so nothing extra to install
    node: { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } },
    ...(python ? { python: () => python.ensure() } : {}),
    onChange: () => win?.webContents.send('plugins:changed'),
  })
  app.on('before-quit', () => plugins.close())
  // Hob's eyes: downloaded after the main model (when Hob "gets smarter"), started when a chat has an image
  const vision = FAKE ? fakeVision() : realVision(paths.vision, async () => {
    // fully on the graphics chip only if it fits next to the main model; otherwise the main model would run out
    const s = setup.state
    const mainModelGB = s.phase === 'ready' ? s.model.sizeGB : s.phase === 'downloading' ? s.target.sizeGB : 0
    const p = await engine.probe()
    return visionFitsGpu({ totalRamGB: os.totalmem() / 1e9, unified: p.gpuType === 'metal' || p.unifiedGB > 0, vramGB: p.vramTotalGB, mainModelGB, visionGB: 3.5 })
  })
  setup.onState((s) => { if ((s.phase === 'downloading' && s.chatReady) || s.phase === 'ready') vision.start() })
  app.on('before-quit', () => vision.stop())
  const ipc = registerIpc({ win: () => win, setup, store, python, paths, filesDir, allowed, search, speech: FAKE ? undefined : speech, plugins, vision, fake: FAKE })
  // install code tools quietly once a model is ready, so they're there before the first file task
  let codeToolsStarted = false
  setup.onState((s) => {
    if (codeToolsStarted || s.phase !== 'ready') return
    codeToolsStarted = true
    plugins.warmUp()
    if (!python) return
    void python.ensure().catch((err) => console.warn('code tools install failed; will retry on first use', err))
  })
  // dev runs use the plain Electron bundle; show Hob's icon in the Dock anyway
  if (process.platform === 'darwin' && !app.isPackaged && !BACKGROUND) app.dock?.setIcon(join(__dirname, '../../build/icon.png'))
  // no Dock icon and no activation: the window can't steal focus
  if (process.platform === 'darwin' && BACKGROUND) app.setActivationPolicy('accessory')
  createWindow()
  // files opened before the window existed wait for the page to load
  openPluginFile = async (path) => {
    if (!win) createWindow()
    if (win!.webContents.isLoading()) await new Promise<void>((r) => win!.webContents.once('did-finish-load', () => r()))
    if (!BACKGROUND) win!.show()
    await ipc.openPluginFile(path)
  }
  for (const f of openedFiles.splice(0)) void openPluginFile(f)
  void setup.start()
  app.on('before-quit', () => engine.dispose())
  app.on('activate', () => { if (!win) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

/** the real vision model and server; downloads once, in the background */
function realVision(root: string, useGpu: () => Promise<boolean>) {
  const listeners = new Set<(s: VisionState) => void>()
  const installer = new VisionInstaller(root, {
    platformKey: `${process.platform}-${process.arch}`, totalRamGB: os.totalmem() / 1e9,
    download: realDeps, fetchFile: realRuntimeDeps.fetchFile, exec: realRuntimeDeps.exec,
  }, (s) => { for (const l of listeners) l(s) })
  const server = new VisionServer({
    command: async () => ({ cmd: await installer.serverBinary() }),
    cpuCommand: async () => { const b = await installer.cpuServerBinary(); return b ? { cmd: b } : undefined },
    model: installer.modelPath, mmproj: installer.mmprojPath, useGpu,
  })
  const start = () => { if (installer.supported) void installer.ensure().catch((err) => console.warn('image support download failed; will retry', err)) }
  return {
    state: () => installer.state, onState: (cb: (s: VisionState) => void) => { listeners.add(cb) },
    ask: (image: string, q: string, signal?: AbortSignal) => server.ask(image, q, signal),
    start, retry: start, stop: () => server.stop(),
  }
}

/** fake mode: always ready; answers like a vision model would */
function fakeVision() {
  return {
    state: (): VisionState => ({ phase: 'ready', name: 'Qwen3-VL 4B', sizeGB: 2.9 }),
    onState: () => {},
    ask: async (_image: string, q: string) => `A receipt from Joe's Cafe. Total: $23.40. (Asked: ${q})`,
    start: () => {}, retry: () => {}, stop: () => {},
  }
}
