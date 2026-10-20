import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Catalog } from '@hob/picker'
import bundled from '../../catalog/catalog.json'
import { computerName, SetupController, type SetupDeps } from '../src/main/setup'
import { FakeEngine, fakeDownloadDeps } from '../src/main/fake'
import { fileNameFor } from '../src/main/downloader'
import { saveSettings } from '../src/main/settings'
import type { SetupState } from '../src/shared/types'

const catalog = bundled as Catalog
const m1max = { os: 'darwin' as const, arch: 'arm64', cpuModel: 'Apple M1 Max', totalRamGB: 32, freeDiskGB: 500, gpu: { kind: 'unified' as const, name: 'Apple M1 Max', vramGB: 24 } }

function setup(over: Partial<SetupDeps> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'hob-setup-'))
  const engine = new FakeEngine()
  const deps: SetupDeps = {
    engine, modelsDir: root, settingsPath: join(root, 'settings.json'),
    getHardware: async () => m1max, getCatalog: async () => catalog,
    download: fakeDownloadDeps(), sha256Override: 'FAKE', ...over,
  }
  const c = new SetupController(deps)
  const states: SetupState[] = []
  c.onState((s) => states.push(s))
  return { c, engine, deps, states, root }
}

describe('SetupController', () => {
  it('lists models with downloaded/active flags and switches without dropping chat', async () => {
    const { c, engine } = setup()
    await c.start(); await c.confirm()
    const active = c.listModels().find((r) => r.active)!
    expect(active.downloaded).toBe(true)
    const other = c.listModels().find((r) => r.available && !r.active && !r.downloaded)!
    const states: SetupState[] = []
    c.onState((s) => states.push(s))
    await c.useModel(other.id)
    const downloading = states.filter((s) => s.phase === 'downloading')
    expect(downloading.length).toBeGreaterThan(0)
    expect(downloading.every((s) => s.phase === 'downloading' && s.chatReady)).toBe(true)
    expect(c.listModels().find((r) => r.active)?.id).toBe(other.id)
    const url = catalog.models.find((m) => m.id === other.id)!.builds[0].url
    expect(engine.loaded).toContain(fileNameFor(url))
    expect(c.state.phase).toBe('ready')
  })

  it('deletes a downloaded model that is not in use, never the active one', async () => {
    const { c } = setup()
    await c.start(); await c.confirm()
    const active = c.listModels().find((r) => r.active)!
    expect(c.deleteModel(active.id)).toBe(false)
    const spare = c.listModels().find((r) => r.downloaded && !r.active)! // the starter
    expect(c.deleteModel(spare.id)).toBe(true)
    expect(c.listModels().find((r) => r.id === spare.id)?.downloaded).toBe(false)
  })
  it('keeps the user settings when a model finishes loading', async () => {
    const { c, deps } = setup()
    saveSettings(deps.settingsPath, { webAccess: true, filesDir: '/somewhere' })
    await c.start(); await c.confirm()
    const saved = JSON.parse(readFileSync(deps.settingsPath, 'utf8'))
    expect(saved).toMatchObject({ webAccess: true, filesDir: '/somewhere', activeModelId: expect.any(String) })
    expect(saved.pendingModelId).toBeUndefined()
  })
  it('start → choose with recommendation', async () => {
    const { c } = setup()
    await c.start()
    expect(c.state).toMatchObject({ phase: 'choose', recommended: { id: 'gpt-oss-20b' }, liteMode: false, needsDiskGB: 0 })
  })
  it('choose says what computer it picked for and that a small model comes first', async () => {
    const { c } = setup()
    await c.start()
    expect(c.state).toMatchObject({ phase: 'choose', computer: 'Apple M1 Max with 32 GB of memory', starter: { id: 'qwen3-1.7b' } })
    expect(computerName({ ...m1max, os: 'win32', cpuModel: 'Intel i7', totalRamGB: 31.9, gpu: { kind: 'discrete', name: 'NVIDIA GeForce RTX 4070', vramGB: 12 } })).toBe('NVIDIA GeForce RTX 4070 (12 GB) and 32 GB of memory')
    expect(computerName({ ...m1max, cpuModel: 'Intel(R) Core(TM) i5-8250U CPU @ 1.60GHz', gpu: { kind: 'none', name: '', vramGB: 0 }, totalRamGB: 16 })).toBe('Intel Core i5-8250U with 16 GB of memory')
  })
  it('the first download says it is the small starter model', async () => {
    const { c, states } = setup()
    await c.start(); await c.confirm()
    const first = states.find((s) => s.phase === 'downloading') as Extract<SetupState, { phase: 'downloading' }>
    expect(first.starter).toMatchObject({ id: 'qwen3-1.7b' })
    expect(states.some((s) => s.phase === 'downloading' && s.chatReady && !s.starter)).toBe(true)
  })
  it('choose lists every catalog model: runnable ones selectable, others greyed with a reason', async () => {
    const { c } = setup()
    await c.start()
    const s = c.state as Extract<SetupState, { phase: 'choose' }>
    expect(s.models).toHaveLength(catalog.models.length)
    expect(s.models.find((m) => m.id === 'gpt-oss-20b')).toMatchObject({ available: true, recommended: true })
    expect(s.models.find((m) => m.id === 'gpt-oss-120b')).toMatchObject({ available: false, reason: 'memory' })
    expect(s.models.every((m) => m.description.length > 0)).toBe(true)
  })
  it('confirm with an unavailable model is ignored', async () => {
    const { c } = setup()
    await c.start(); await c.confirm('gpt-oss-120b')
    expect(c.state).toMatchObject({ phase: 'ready', model: { id: 'gpt-oss-20b' } })
  })
  it('confirm → starter first (chat ready), then main model → ready', async () => {
    const { c, engine, states } = setup()
    await c.start(); await c.confirm()
    expect(states.some((s) => s.phase === 'downloading' && s.chatReady)).toBe(true)
    expect(c.state).toMatchObject({ phase: 'ready', model: { id: 'gpt-oss-20b' } })
    expect(engine.loaded).toContain('gpt-oss-20b-MXFP4')
  })
  it('first-run starter download reports progress (bar must not sit at 0%)', async () => {
    const { c, states } = setup()
    await c.start(); await c.confirm()
    const beforeChat = states.filter((s) => s.phase === 'downloading' && !s.chatReady) as { progress: number }[]
    expect(beforeChat.some((s) => s.progress > 0 && s.progress < 1)).toBe(true)
  })
  it('starter fails to load → skip it and still install the main model', async () => {
    const { c, engine } = setup()
    engine.failLoadFor.add('Qwen3-1.7B')
    await c.start(); await c.confirm()
    expect(c.state).toMatchObject({ phase: 'ready', model: { id: 'gpt-oss-20b' } })
  })
  it('quit mid-download → relaunch resumes it (no welcome screen), chatting on the starter meanwhile', async () => {
    const { deps, root } = setup()
    const starterUrl = catalog.models.find((m) => m.id === 'qwen3-1.7b')!.builds[0].url
    writeFileSync(join(root, fileNameFor(starterUrl)), 'x'); writeFileSync(join(root, fileNameFor(starterUrl) + '.ok'), 'FAKE')
    saveSettings(deps.settingsPath, { activeModelId: 'qwen3-1.7b', pendingModelId: 'gpt-oss-20b' })
    const c = new SetupController(deps)
    const states: SetupState[] = []
    c.onState((s) => states.push(s))
    await c.start()
    expect(states.some((s) => s.phase === 'choose')).toBe(false)
    expect(states.some((s) => s.phase === 'downloading' && s.chatReady)).toBe(true)
    expect(c.state).toMatchObject({ phase: 'ready', model: { id: 'gpt-oss-20b' } })
  })
  it('first run saves the pending download so a relaunch can resume it', async () => {
    const { c, deps } = setup()
    let seen: unknown
    c.onState((s) => { if (s.phase === 'downloading' && s.chatReady && !seen) seen = JSON.parse(readFileSync(deps.settingsPath, 'utf8')) })
    await c.start(); await c.confirm()
    expect(seen).toMatchObject({ pendingModelId: 'gpt-oss-20b' })
    expect(JSON.parse(readFileSync(deps.settingsPath, 'utf8')).pendingModelId).toBeUndefined()
  })
  it('relaunch with saved, verified model → straight to ready, no download', async () => {
    const { deps, root } = setup()
    const url = catalog.models.find((m) => m.id === 'gpt-oss-20b')!.builds[0].url
    writeFileSync(join(root, fileNameFor(url)), 'x'); writeFileSync(join(root, fileNameFor(url) + '.ok'), 'FAKE')
    saveSettings(deps.settingsPath, { activeModelId: 'gpt-oss-20b' })
    let downloads = 0
    const c = new SetupController({ ...deps, download: { ...deps.download, download: async () => { downloads++ } } })
    await c.start()
    expect(c.state).toMatchObject({ phase: 'ready' })
    expect(downloads).toBe(0)
  })
  it('not enough disk → choose shows needsDiskGB, confirm → error', async () => {
    const { c } = setup({ getHardware: async () => ({ ...m1max, freeDiskGB: 20 }), download: fakeDownloadDeps({ freeDiskGB: 20 }) })
    await c.start()
    expect(c.state).toMatchObject({ phase: 'choose', needsDiskGB: 2.11 })
    await c.confirm()
    expect(c.state.phase).toBe('error')
    expect((c.state as { message: string }).message).toMatch(/Free up \d+ GB/)
  })
  it('OOM on load → falls back to next smaller model with a note', async () => {
    const { c, engine } = setup()
    engine.failLoadFor.add('gpt-oss-20b-MXFP4')
    await c.start(); await c.confirm()
    expect(c.state).toMatchObject({ phase: 'ready', note: 'Ready · lighter model' })
    expect((c.state as { model: { id: string } }).model.id).not.toBe('gpt-oss-20b')
  })
  it('nothing fits → friendly error', async () => {
    const { c } = setup({ getHardware: async () => ({ ...m1max, totalRamGB: 2, gpu: { kind: 'none', name: '', vramGB: 0 } }) })
    await c.start()
    expect(c.state).toMatchObject({ phase: 'error', message: expect.stringMatching(/needs at least 8 GB/) })
  })
  it('user can pick a different option', async () => {
    const { c } = setup()
    await c.start(); await c.confirm('gpt-oss-20b')
    expect(c.state).toMatchObject({ phase: 'ready', model: { id: 'gpt-oss-20b' } })
  })
})

describe('SetupController review fixes', () => {
  it('I1: not enough disk → error before ANY download (starter included)', async () => {
    let downloads = 0
    const dl = fakeDownloadDeps({ freeDiskGB: 20 })
    const { c } = setup({ getHardware: async () => ({ ...m1max, freeDiskGB: 20 }), download: { ...dl, download: async (...a) => { downloads++; return dl.download(...a) } } })
    await c.start(); await c.confirm()
    expect(c.state).toMatchObject({ phase: 'error', message: expect.stringMatching(/Free up \d+ GB/) })
    expect(downloads).toBe(0)
  })
  it('I1: counts starter + main model against free disk', async () => {
    // 12.11 + 1.83 + 10 = 23.94 needed; 23 free → must refuse up front
    let downloads = 0
    const dl = fakeDownloadDeps({ freeDiskGB: 23 })
    const { c } = setup({ download: { ...dl, download: async (...a) => { downloads++; return dl.download(...a) } } })
    await c.start(); await c.confirm()
    expect(c.state.phase).toBe('error')
    expect(downloads).toBe(0)
  })
  it('I3: engine crash after ready → model is reloaded automatically', async () => {
    const { c, engine } = setup()
    await c.start(); await c.confirm()
    const loaded = engine.loaded
    engine.crash()
    expect(engine.loaded).toBeUndefined()
    await new Promise((r) => setTimeout(r, 50))
    expect(engine.loaded).toBe(loaded)
    expect(c.state).toMatchObject({ phase: 'ready' })
  })
  it('I4: lighter-model fallback that needs a download shows progress and keeps chat alive on the starter', async () => {
    const { c, engine, states } = setup()
    engine.failLoadFor.add('gpt-oss-20b-MXFP4')
    const loadedDuringFallbackDownload: (string | undefined)[] = []
    const off = c.onState((s) => { if (s.phase === 'downloading' && s.note === 'Switching to a lighter model…') loadedDuringFallbackDownload.push(engine.loaded) })
    await c.start(); await c.confirm()
    off()
    const fallback = states.filter((s) => s.phase === 'downloading' && s.note === 'Switching to a lighter model…')
    expect(fallback.some((s) => s.phase === 'downloading' && s.progress > 0)).toBe(true)
    expect(fallback.every((s) => s.phase === 'downloading' && s.chatReady)).toBe(true)
    expect(loadedDuringFallbackDownload.every((p) => p?.includes('Qwen3-1.7B'))).toBe(true)
    expect(c.state).toMatchObject({ phase: 'ready', note: 'Ready · lighter model' })
  })
  it('I5: a saved "smarter" choice is reused on relaunch', async () => {
    const m1 = { ...m1max, cpuModel: 'Apple M1', totalRamGB: 16, gpu: { kind: 'unified' as const, name: 'Apple M1', vramGB: 12 } }
    const { c, deps } = setup({ getHardware: async () => m1 })
    await c.start()
    // qwen3-14b is the slower "smarter" pick on a base M1, and it must be selectable
    const models = (c.state as Extract<SetupState, { phase: 'choose' }>).models
    expect(models.find((m) => m.id === 'qwen3-14b')).toMatchObject({ available: true })
    await c.confirm('qwen3-14b')
    expect(c.state).toMatchObject({ phase: 'ready', model: { id: 'qwen3-14b' } })
    const c2 = new SetupController(deps)
    await c2.start()
    expect(c2.state).toMatchObject({ phase: 'ready', model: { id: 'qwen3-14b' } })
  })
  it('I6: confirm twice → second call ignored (one download per file)', async () => {
    const counts = new Map<string, number>()
    const dl = fakeDownloadDeps()
    const { c } = setup({ download: { ...dl, download: async (u, d, f, p) => { counts.set(f, (counts.get(f) ?? 0) + 1); return dl.download(u, d, f, p) } } })
    await c.start()
    await Promise.all([c.confirm(), c.confirm()])
    expect([...counts.values()].every((n) => n === 1)).toBe(true)
    expect(c.state.phase).toBe('ready')
  })
  it('I9: background download failure while chatting keeps the user in chat with a retry', async () => {
    const dl = fakeDownloadDeps()
    let fail = true
    const { c } = setup({
      retryDelaysMs: [1, 1],
      download: { ...dl, download: async (u, d, f, p) => { if (f.includes('gpt-oss-20b') && fail) throw new Error('fetch failed'); return dl.download(u, d, f, p) } },
    })
    await c.start(); await c.confirm()
    expect(c.state).toMatchObject({ phase: 'ready', model: { id: 'qwen3-1.7b' }, canRetry: true, note: expect.stringMatching(/connection/i) })
    fail = false
    await c.retry()
    expect(c.state).toMatchObject({ phase: 'ready', model: { id: 'gpt-oss-20b' } })
  })
  it('I9: transient download failures are retried with backoff', async () => {
    const dl = fakeDownloadDeps()
    let failures = 2
    const { c } = setup({
      retryDelaysMs: [1, 1],
      download: { ...dl, download: async (u, d, f, p) => { if (f.includes('gpt-oss-20b') && failures-- > 0) throw new Error('fetch failed'); return dl.download(u, d, f, p) } },
    })
    await c.start(); await c.confirm()
    expect(c.state).toMatchObject({ phase: 'ready', model: { id: 'gpt-oss-20b' } })
  })
})

describe('SetupController disk re-check', () => {
  it('retry on the choose screen re-checks disk after the user frees space', async () => {
    let free = 20
    const { c } = setup({ getHardware: async () => ({ ...m1max, freeDiskGB: free }) })
    await c.start()
    expect(c.state).toMatchObject({ phase: 'choose', needsDiskGB: 2.11 })
    free = 200
    await c.retry()
    expect(c.state).toMatchObject({ phase: 'choose', needsDiskGB: 0 })
  })
})
