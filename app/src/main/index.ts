import { app, BrowserWindow, nativeTheme, Notification, protocol, safeStorage, session, shell } from 'electron'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import bundledCatalog from '../../../catalog/catalog.json'
import licenses from '../../../catalog/licenses.json'
import { makePaths } from './paths'
import { UtilityEngine } from './engine'
import { fakeAccounts, FakeEngine, fakeDownloadDeps } from './fake'
import { realDeps } from './downloader'
import { CATALOG_URL, loadCatalog } from './catalog'
import { readSysInfo, toHardware } from './hardware'
import type { Hardware } from '@hob/picker'
import { SetupController } from './setup'
import { registerIpc } from './ipc'
import { Notices, type Notice } from './notify'
import { deleteAfterExit, removalPlan } from './uninstall'
import { Store } from './store'
import { migrateFilesDir, migrateProfile } from './migrate'
import { TITLE_BAR_HEIGHT, titleBarColors } from './titleBar'
import { logToFile } from './log'
import { pruneUndo } from './agent/journal'
import { PythonRuntime, realRuntimeDeps } from './python/runtime'
import { VisionInstaller } from './vision/install'
import { macCalMail, setCalMailSource, setMacDeps } from './tools/mac'
import { Accounts } from './accounts'
import { VisionServer } from './vision/server'
import { pickVision, VISION_MODELS, visionFitsGpu, visionGB } from './vision/catalog'
import type { VisionState } from '../shared/types'
import os from 'node:os'
import { loadSettings, localeOf, updateSettings, webAccessOn } from './settings'
import { startUpdates, updatesOn } from './updates'
import { setLanguage } from '../shared/i18n'
import { systemLocale } from './locale'
import { PluginRegistry } from './plugins/registry'
import { loginPath } from './plugins/shellPath'
import { coreTools, nativeTools } from './tools'
import { isInside } from './workspace'
import { SearxngServer, type SearchResult } from './search/searxng'
import { SpeechModel } from './speech'

const FAKE = process.env.HOB_FAKE === '1'
// Windows shows notifications only for an app with this id (the installer's shortcut carries the same one)
if (process.platform === 'win32') app.setAppUserModelId('com.frigade.hob')
/** with HOB_FAKE: the stand-in model, but the real tools (Python, web search, the image model), for the smoke test */
const REAL_TOOLS = FAKE && process.env.HOB_REAL_TOOLS === '1'
// One profile folder however Hob is started (dev, packaged, tests): ~/Library/Application Support/Hob etc.
app.setName('Hob')
// renamed from Garth (and Mabel, Thrum): carry an existing profile (models, chats, settings) over once
if (!process.env.HOB_USER_DATA) migrateProfile(app.getPath('appData'))
app.setPath('userData', process.env.HOB_USER_DATA ?? join(app.getPath('appData'), 'Hob'))
logToFile(join(app.getPath('userData'), 'logs', 'main.log'))
process.on('unhandledRejection', (err) => console.error('unhandled rejection', err))

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

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', json: 'application/json', pdf: 'application/pdf' }
const mimeOf = (p: string) => MIME[p.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream'

// shows images the agent made, from chat folders and granted folders only
protocol.registerSchemesAsPrivileged([{ scheme: 'hob-file', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])

function createWindow() {
  win = new BrowserWindow({
    width: 1100, height: 760, minWidth: 720, minHeight: 520,
    // Mac: traffic lights centred on the sidebar toggle (top-2, 32px tall: centre at 24px). Elsewhere: the window
    // buttons over the top-right corner, and no menu bar
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 17 } }
      : { titleBarStyle: 'hidden' as const, titleBarOverlay: { ...titleBarColors(nativeTheme.shouldUseDarkColors), height: TITLE_BAR_HEIGHT }, autoHideMenuBar: true }),
    backgroundColor: titleBarColors(nativeTheme.shouldUseDarkColors).color,
    show: !BACKGROUND,
    // hidden pages would otherwise pause timers and animations
    webPreferences: { preload: join(__dirname, '../preload/index.cjs'), sandbox: false, ...(BACKGROUND ? { backgroundThrottling: false } : {}) },
  })
  if (process.platform !== 'darwin') {
    win.setMenuBarVisibility(false)
    // the window buttons follow light and dark mode
    const recolor = () => win?.setTitleBarOverlay({ ...titleBarColors(nativeTheme.shouldUseDarkColors), height: TITLE_BAR_HEIGHT })
    nativeTheme.on('updated', recolor)
    win.on('closed', () => nativeTheme.off('updated', recolor))
  }
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

// shown notifications are kept until clicked or closed: one that's garbage-collected loses its click
const showing = new Set<Notification>()
function showNotice(n: Notice) {
  if (!Notification.isSupported()) return
  const note = new Notification({ title: n.title, body: n.body })
  showing.add(note)
  note.on('click', () => { showing.delete(note); n.onClick() })
  note.on('close', () => showing.delete(note))
  note.show()
}
/** test runs: notifications are recorded, never shown; e2e tests click them through here */
const fakeNotices: Notice[] = []
if (FAKE) (globalThis as { hobNotices?: Notice[] }).hobNotices = fakeNotices

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
  // the theme picked in Settings; the system's when none
  nativeTheme.themeSource = loadSettings(paths.settings).theme ?? 'system'
  setLanguage(localeOf(loadSettings(paths.settings), systemLocale()))
  if (updatesOn({ packaged: app.isPackaged, fake: FAKE, profile: !!process.env.HOB_USER_DATA, platform: process.platform, appImage: !!process.env.APPIMAGE })) {
    startUpdates().catch((err) => console.warn("couldn't start looking for new versions", err))
  }
  const engine = FAKE ? new FakeEngine() : new UtilityEngine(join(__dirname, 'engine.js'))
  /** the computer, as setup found it (the vision model's room is worked out from it) */
  let hardware: Hardware | undefined
  const setup = new SetupController({
    engine,
    modelsDir: paths.models,
    settingsPath: paths.settings,
    download: FAKE ? fakeDownloadDeps({ stepMs: Number(process.env.HOB_FAKE_STEP_MS) || undefined, freeDiskGB: Number(process.env.HOB_FAKE_FREE_GB) || undefined }) : realDeps,
    sha256Override: FAKE ? 'FAKE' : undefined,
    getHardware: FAKE
      ? async () => ({ os: 'darwin' as const, arch: 'arm64', cpuModel: 'Apple M1 Max', totalRamGB: 32, freeDiskGB: Number(process.env.HOB_FAKE_FREE_GB) || 500, gpu: { kind: 'unified' as const, name: 'Apple M1 Max', vramGB: 24 } })
      // a second try runs without the graphics card if the first one crashed the engine
      : async () => (hardware = toHardware(await engine.probe().catch(() => engine.probe()), await readSysInfo(paths.models))),
    // HOB_LOCAL_CATALOG=1: only the catalog in this build (to try models before they're published)
    getCatalog: () => loadCatalog({ url: CATALOG_URL, cachePath: paths.catalogCache, bundled: bundledCatalog, licenses, fetchFn: FAKE || process.env.HOB_LOCAL_CATALOG ? (async () => { throw new Error('offline') }) as unknown as typeof fetch : undefined }),
  })
  const store = new Store(paths.db)
  pruneUndo(paths.undo, { olderThanDays: 30 })
  const python = FAKE && !REAL_TOOLS ? undefined : new PythonRuntime(paths.python, realRuntimeDeps)
  // E2E / custom profiles keep chat files inside the profile, never in the real Documents
  if (!process.env.HOB_USER_DATA && !loadSettings(paths.settings).filesDir) {
    // chat files from the app's earlier names. macOS may refuse the move (no access to Documents yet):
    // then the old folder stays the chat files folder, and start-up carries on
    for (const name of ['Garth', 'Mabel', 'Thrum']) {
      const from = join(app.getPath('documents'), name)
      try { migrateFilesDir(from, join(app.getPath('documents'), 'Hob'), store) } catch (err) {
        console.warn(`couldn't move ${from}; keeping it as the chat files folder`, err)
        updateSettings(paths.settings, { filesDir: from })
        break
      }
    }
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
  const search = FAKE && !REAL_TOOLS
    ? async (q: string): Promise<SearchResult[]> => [{ title: `Lisbon: results for ${q}`, url: 'https://example.com/lisbon', snippet: 'Sunny, 24°C.' }]
    : async (q: string, signal: AbortSignal) => { await python!.ensureSearxng(); return searx!.search(q, signal) }
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
  // what the vision model has to share the computer with: the main model, and the memory the graphics chip can use
  const room = async () => {
    const s = setup.state
    const mainModelGB = s.phase === 'ready' ? s.model.sizeGB : s.phase === 'downloading' ? s.target.sizeGB : 0
    // what start-up found; never ask the engine here: mid-reply it's busy waiting for this very image, and would never answer
    const hw = hardware
    return { totalRamGB: os.totalmem() / 1e9, unified: hw ? hw.gpu.kind !== 'discrete' : process.platform === 'darwin', vramGB: hw?.gpu.vramGB, mainModelGB }
  }
  const vision = FAKE && !REAL_TOOLS ? fakeVision() : realVision(paths.vision, room)
  // fake mode: a calendar and an inbox to talk to
  if (FAKE) setMacDeps({
    helper: async (args) => (args[0] === 'events'
      ? [{ title: 'Dentist', start: '2026-10-22T09:00:00Z', end: '2026-10-22T10:00:00Z', allDay: false, calendar: 'Home' }]
      : args[0] === 'add-event' ? { ...JSON.parse(args[1]), calendar: 'Home' } : { status: 'granted' }),
    mail: async (script, args) => (script.includes('readStatus')
      ? JSON.stringify([{ id: 7, subject: 'Your flight to Lisbon', from: 'TAP Air <no-reply@tap.pt>', date: '2026-10-20T08:00:00Z', read: false }])
      : script.includes('OutgoingMessage') ? 'ok'
      : JSON.stringify({ subject: 'Your flight to Lisbon', from: 'TAP Air', date: '2026-10-20T08:00:00Z', to: ['me@example.com'], content: `Booking ${args[0]}: departs 24 Oct 07:15.` })),
  })
  setup.onState((s) => { if ((s.phase === 'downloading' && s.chatReady) || s.phase === 'ready') vision.start() })
  // dictation's model too, as soon as chat works, so the mic is ready the first time it's clicked
  // (once: setup reports download progress many times a second; again after a failed try, e.g. offline)
  let fetchingSpeech = false
  if (!FAKE) setup.onState((s) => {
    if (fetchingSpeech || !((s.phase === 'downloading' && s.chatReady) || s.phase === 'ready')) return
    fetchingSpeech = true
    speech.ensure().catch((err) => { fetchingSpeech = false; console.warn("couldn't download the dictation model yet", err) })
  })
  app.on('before-quit', () => vision.stop())
  // a Google or Microsoft account for calendar and email; on a Mac, the Calendar and Mail apps otherwise
  const accounts = FAKE ? fakeAccounts() : new Accounts({
    file: join(paths.root, 'accounts.bin'),
    encrypt: (v) => (safeStorage.isEncryptionAvailable() ? Buffer.concat([Buffer.from('enc:'), safeStorage.encryptString(v)]) : Buffer.from(`plain:${v}`)),
    decrypt: (b) => (b.subarray(0, 4).toString() === 'enc:' ? safeStorage.decryptString(b.subarray(4)) : b.toString().replace(/^plain:/, '')),
    open: (url) => shell.openExternal(url),
  })
  setCalMailSource(() => accounts.calMail() ?? (process.platform === 'darwin' ? macCalMail : undefined))
  const notices = new Notices({
    focused: () => !!win && win.isVisible() && !win.isMinimized() && win.isFocused(),
    show: (n) => (FAKE ? fakeNotices.push(n) : showNotice(n)),
    title: (id) => store.getChat(id)?.title,
    open: (id) => {
      if (!win) createWindow()
      const w = win!
      if (w.isMinimized()) w.restore()
      w.show(); w.focus()
      if (process.platform === 'darwin') app.focus({ steal: true })
      const go = () => w.webContents.send('chat:open', id)
      if (w.webContents.isLoading()) w.webContents.once('did-finish-load', go); else go()
    },
  })
  const removeHob = async () => {
    const plan = removalPlan({ platform: process.platform, packaged: app.isPackaged, profile: !!process.env.HOB_USER_DATA, execPath: process.execPath, appImage: process.env.APPIMAGE, data: app.getPath('userData') })
    // Windows: Hob's uninstaller closes Hob, then removes the app and its data
    if (plan.uninstaller) spawn(plan.uninstaller, ['/S', '--delete-app-data'], { detached: true, stdio: 'ignore' }).unref()
    if (plan.data) deleteAfterExit(plan.data)
    if (plan.app) await shell.trashItem(plan.app).catch((err) => console.warn('could not move Hob to the Trash', err))
    app.quit()
  }
  const ipc = registerIpc({ win: () => win, setup, store, python, paths, filesDir, allowed, search, speech: FAKE ? undefined : speech, plugins, vision, accounts, notices, removeHob, fake: FAKE })
  // install code tools quietly once a model is ready, so they're there before the first file task
  let codeToolsStarted = false
  setup.onState((s) => {
    if (codeToolsStarted || s.phase !== 'ready') return
    codeToolsStarted = true
    plugins.warmUp()
    if (!python) return
    void python.ensure()
      .then(() => python.ensureSearxng().catch((err) => console.warn('web search install failed; will retry on first search', err)))
      .catch((err) => console.warn('code tools install failed; will retry on first use', err))
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
function realVision(root: string, room: () => Promise<{ totalRamGB: number; unified: boolean; vramGB?: number; mainModelGB: number }>) {
  const listeners = new Set<(s: VisionState) => void>()
  const installer = new VisionInstaller(root, {
    // the smoke test runs on CI machines without a graphics card: the small model, on the CPU
    platformKey: `${process.platform}-${process.arch}`, choose: async () => (REAL_TOOLS ? VISION_MODELS['2b'] : pickVision(await room())),
    download: realDeps, fetchFile: realRuntimeDeps.fetchFile, exec: realRuntimeDeps.exec,
  }, (s) => { for (const l of listeners) l(s) })
  const server = new VisionServer({
    command: async () => ({ cmd: await installer.serverBinary() }),
    cpuCommand: async () => { const b = await installer.cpuServerBinary(); return b ? { cmd: b } : undefined },
    model: () => installer.modelPath, mmproj: () => installer.mmprojPath,
    // fully on the graphics chip only if it fits next to the main model; otherwise the main model would run out
    useGpu: async () => !REAL_TOOLS && visionFitsGpu({ ...await room(), visionGB: visionGB(installer.model) }),
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
