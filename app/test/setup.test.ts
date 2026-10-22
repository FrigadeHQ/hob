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
  it('keeps the small starter model loaded next to the big one for side jobs, only with memory to spare', async () => {
    const big = setup({ getHardware: async () => ({ ...m1max, totalRamGB: 64, gpu: { kind: 'unified' as const, name: 'Apple M1 Max', vramGB: 48 } }) })
    await big.c.start(); await big.c.confirm()
    const { vi } = await import('vitest')
    await vi.waitFor(() => expect(big.engine.side).toMatch(/E4B/i))
    // 32 GB: a second model next to the big one slowed the first reply (~1 s → ~5 s on gpt-oss-20b, M1 Max)
    const mid = setup()
    await mid.c.start(); await mid.c.confirm()
    await new Promise((r) => setTimeout(r, 50))
    expect(mid.engine.side).toBeUndefined()
  })

  it('a pick smaller than the starter is downloaded on its own, without the starter first', async () => {
    const { c, engine, states } = setup()
    await c.start(); await c.confirm('gemma-4-e2b')
    expect(c.state).toMatchObject({ phase: 'ready', model: { id: 'gemma-4-e2b' } })
    expect(states.some((s) => s.phase === 'downloading' && !!s.starter)).toBe(false)
    expect(engine.loaded).toContain('gemma-4-E2B')
  })

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
    expect(downloading).not.toEqual(expect.arrayContaining([expect.objectContaining({ initialUpgrade: true })]))
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
  it('start-up knows whether this is the first launch (no model set up yet)', async () => {
    const { c, deps } = setup()
    expect(c.state).toEqual({ phase: 'probing', firstRun: true })
    await c.start(); await c.confirm()
    const again = new SetupController(deps)
    expect(again.state).toEqual({ phase: 'probing', firstRun: false })
  })
  it('a model download from Settings can be cancelled: chat stays on the current model, nothing is flagged as failed', async () => {
    const { c, engine, deps } = setup({ download: fakeDownloadDeps({ stepMs: 200 }) })
    await c.start(); await c.confirm()
    const before = (c.state as { model: { id: string } }).model.id
    const other = c.listModels().find((m) => m.available && !m.downloaded && !m.active)!
    const going = c.useModel(other.id)
    await new Promise((r) => setTimeout(r, 250))
    expect(c.state.phase).toBe('downloading')
    expect(c.cancel()).toBe(true)
    await going
    expect(c.state).toMatchObject({ phase: 'ready', model: { id: before } })
    expect(c.state).not.toHaveProperty('note')
    expect(JSON.parse(readFileSync(deps.settingsPath, 'utf8')).pendingModelId).toBeUndefined()
    expect(c.cancel()).toBe(false)
  })
  it('start → choose with recommendation', async () => {
    const { c } = setup()
    await c.start()
    expect(c.state).toMatchObject({ phase: 'choose', recommended: { id: 'gemma-4-26b-a4b' }, liteMode: false, needsDiskGB: 0 })
  })
  it('choose says what computer it picked for and that a small model comes first', async () => {
    const { c } = setup()
    await c.start()
    expect(c.state).toMatchObject({ phase: 'choose', computer: 'Apple M1 Max · 32 GB memory', starter: { id: 'gemma-4-e4b' } })
    expect(computerName({ ...m1max, os: 'win32', cpuModel: 'Intel i7', totalRamGB: 31.9, gpu: { kind: 'discrete', name: 'NVIDIA GeForce RTX 4070', vramGB: 12 } })).toBe('NVIDIA GeForce RTX 4070 (12 GB) · 32 GB memory')
    expect(computerName({ ...m1max, cpuModel: 'Intel(R) Core(TM) i5-8250U CPU @ 1.60GHz', gpu: { kind: 'none', name: '', vramGB: 0 }, totalRamGB: 16 })).toBe('Intel Core i5-8250U · 16 GB memory')
  })
  it('the first download says it is the small starter model', async () => {
    const { c, states } = setup()
    await c.start(); await c.confirm()
    const first = states.find((s) => s.phase === 'downloading') as Extract<SetupState, { phase: 'downloading' }>
    expect(first.starter).toMatchObject({ id: 'gemma-4-e4b' })
    expect(states.some((s) => s.phase === 'downloading' && s.chatReady && !s.starter)).toBe(true)
    expect(states).toContainEqual(expect.objectContaining({ phase: 'downloading', chatReady: true, initialUpgrade: true }))
  })
  it('choosing a model manually after choosing the starter is not the initial upgrade', async () => {
    const { c, states } = setup()
    await c.start(); await c.confirm('gemma-4-e4b')
    states.length = 0
    await c.useModel('gpt-oss-20b')
    const downloading = states.filter((s) => s.phase === 'downloading')
    expect(downloading.length).toBeGreaterThan(0)
    expect(downloading).not.toEqual(expect.arrayContaining([expect.objectContaining({ initialUpgrade: true })]))
  })
  it.each([undefined, 'gemma-4-e4b'])('resumed downloads retain whether a model was already chosen (%s)', async (activeModelId) => {
    const { deps } = setup()
    saveSettings(deps.settingsPath, { activeModelId, pendingModelId: 'gemma-4-26b-a4b' })
    const c = new SetupController(deps)
    const states: SetupState[] = []
    c.onState((s) => states.push(s))
    await c.start()
    expect(states).toContainEqual(expect.objectContaining({ phase: 'downloading', chatReady: true, initialUpgrade: !activeModelId }))
  })
  it('choose lists the catalog models: runnable ones selectable, others greyed with a reason', async () => {
    const { c } = setup()
    await c.start()
    const s = c.state as Extract<SetupState, { phase: 'choose' }>
    // on this 32 GB Mac the tiny last-resort model and the squeezed 26B aren't offered: better ones run
    expect(s.models.map((m) => m.id)).not.toContain('qwen3-1.7b')
    expect(s.models.map((m) => m.id)).not.toContain('gemma-4-26b-a4b-compact')
    expect(s.models).toHaveLength(catalog.models.length - 2)
    expect(s.models.find((m) => m.id === 'gemma-4-26b-a4b')).toMatchObject({ available: true, recommended: true })
    expect(s.models.find((m) => m.id === 'gpt-oss-120b')).toMatchObject({ available: false, reason: 'memory' })
    expect(s.models.every((m) => m.description.length > 0)).toBe(true)
  })
  it('confirm with an unavailable model is ignored', async () => {
    const { c } = setup()
    await c.start(); await c.confirm('gpt-oss-120b')
    expect(c.state).toMatchObject({ phase: 'ready', model: { id: 'gemma-4-26b-a4b' } })
  })
  it('confirm → starter first (chat ready), then main model → ready', async () => {
    const { c, engine, states } = setup()
    await c.start(); await c.confirm()
    expect(states.some((s) => s.phase === 'downloading' && s.chatReady)).toBe(true)
    expect(c.state).toMatchObject({ phase: 'ready', model: { id: 'gemma-4-26b-a4b' } })
    expect(engine.loaded).toContain('gemma-4-26B_q4_0')
  })
  it('first-run starter download reports progress (bar must not sit at 0%)', async () => {
    const { c, states } = setup()
    await c.start(); await c.confirm()
    const beforeChat = states.filter((s) => s.phase === 'downloading' && !s.chatReady) as { progress: number }[]
    expect(beforeChat.some((s) => s.progress > 0 && s.progress < 1)).toBe(true)
  })
  it('starter fails to load → skip it and still install the main model', async () => {
    const { c, engine } = setup()
    engine.failLoadFor.add('gemma-4-E4B')
    await c.start(); await c.confirm()
    expect(c.state).toMatchObject({ phase: 'ready', model: { id: 'gemma-4-26b-a4b' } })
  })
  it('quit mid-download → relaunch resumes it (no welcome screen), chatting on the starter meanwhile', async () => {
    const { deps, root } = setup()
    const starterUrl = catalog.models.find((m) => m.id === 'gemma-4-e4b')!.builds[0].url
    writeFileSync(join(root, fileNameFor(starterUrl)), 'x'); writeFileSync(join(root, fileNameFor(starterUrl) + '.ok'), 'FAKE')
    saveSettings(deps.settingsPath, { activeModelId: 'gemma-4-e4b', pendingModelId: 'gemma-4-26b-a4b' })
    const c = new SetupController(deps)
    const states: SetupState[] = []
    c.onState((s) => states.push(s))
    await c.start()
    expect(states.some((s) => s.phase === 'choose')).toBe(false)
    expect(states.some((s) => s.phase === 'downloading' && s.chatReady)).toBe(true)
    expect(c.state).toMatchObject({ phase: 'ready', model: { id: 'gemma-4-26b-a4b' } })
  })
  it('first run saves the pending download so a relaunch can resume it', async () => {
    const { c, deps } = setup()
    let seen: unknown
    c.onState((s) => { if (s.phase === 'downloading' && s.chatReady && !seen) seen = JSON.parse(readFileSync(deps.settingsPath, 'utf8')) })
    await c.start(); await c.confirm()
    expect(seen).toMatchObject({ pendingModelId: 'gemma-4-26b-a4b' })
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
    expect(c.state).toMatchObject({ phase: 'choose', needsDiskGB: 4.44 })
    await c.confirm()
    expect(c.state.phase).toBe('error')
    expect((c.state as { message: string }).message).toMatch(/Free up \d+ GB/)
  })
  it('OOM on load → falls back to next smaller model with a note', async () => {
    const { c, engine } = setup()
    engine.failLoadFor.add('gemma-4-26B_q4_0')
    await c.start(); await c.confirm()
    expect(c.state).toMatchObject({ phase: 'ready', note: 'Ready · lighter model' })
    expect((c.state as { model: { id: string } }).model.id).not.toBe('gemma-4-26b-a4b')
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
    // 14.44 + 5.15 + 10 = 29.59 needed; 28 free → must refuse up front
    let downloads = 0
    const dl = fakeDownloadDeps({ freeDiskGB: 28 })
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
    engine.failLoadFor.add('gemma-4-26B_q4_0')
    const loadedDuringFallbackDownload: (string | undefined)[] = []
    const off = c.onState((s) => { if (s.phase === 'downloading' && s.note === 'Switching to a lighter model…') loadedDuringFallbackDownload.push(engine.loaded) })
    await c.start(); await c.confirm()
    off()
    const fallback = states.filter((s) => s.phase === 'downloading' && s.note === 'Switching to a lighter model…')
    expect(fallback.some((s) => s.phase === 'downloading' && s.progress > 0)).toBe(true)
    expect(fallback.every((s) => s.phase === 'downloading' && s.chatReady)).toBe(true)
    expect(loadedDuringFallbackDownload.every((p) => p?.includes('gemma-4-E4B'))).toBe(true)
    expect(c.state).toMatchObject({ phase: 'ready', note: 'Ready · lighter model' })
  })
  it('I5: a saved choice other than the recommended one is reused on relaunch', async () => {
    const m1 = { ...m1max, cpuModel: 'Apple M1', totalRamGB: 16, gpu: { kind: 'unified' as const, name: 'Apple M1', vramGB: 12 } }
    const { c, deps } = setup({ getHardware: async () => m1 })
    await c.start()
    // a pick other than the recommended one, selectable on a base M1
    const models = (c.state as Extract<SetupState, { phase: 'choose' }>).models
    expect(models.find((m) => m.id === 'gemma-4-e2b')).toMatchObject({ available: true })
    await c.confirm('gemma-4-e2b')
    expect(c.state).toMatchObject({ phase: 'ready', model: { id: 'gemma-4-e2b' } })
    const c2 = new SetupController(deps)
    await c2.start()
    expect(c2.state).toMatchObject({ phase: 'ready', model: { id: 'gemma-4-e2b' } })
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
    const { c, states } = setup({
      retryDelaysMs: [1, 1],
      download: { ...dl, download: async (u, d, f, p) => { if (f.includes('gemma-4-26B') && fail) throw new Error('fetch failed'); return dl.download(u, d, f, p) } },
    })
    await c.start(); await c.confirm()
    expect(c.state).toMatchObject({ phase: 'ready', model: { id: 'gemma-4-e4b' }, canRetry: true, note: expect.stringMatching(/connection/i) })
    fail = false
    states.length = 0
    await c.retry()
    expect(states).toContainEqual(expect.objectContaining({ phase: 'downloading', chatReady: true, initialUpgrade: true }))
    expect(c.state).toMatchObject({ phase: 'ready', model: { id: 'gemma-4-26b-a4b' } })
  })
  it('I9: transient download failures are retried with backoff', async () => {
    const dl = fakeDownloadDeps()
    let failures = 2
    const { c } = setup({
      retryDelaysMs: [1, 1],
      download: { ...dl, download: async (u, d, f, p) => { if (f.includes('gemma-4-26B') && failures-- > 0) throw new Error('fetch failed'); return dl.download(u, d, f, p) } },
    })
    await c.start(); await c.confirm()
    expect(c.state).toMatchObject({ phase: 'ready', model: { id: 'gemma-4-26b-a4b' } })
  })
})

describe('SetupController disk re-check', () => {
  it('retry on the choose screen re-checks disk after the user frees space', async () => {
    let free = 20
    const { c } = setup({ getHardware: async () => ({ ...m1max, freeDiskGB: free }) })
    await c.start()
    expect(c.state).toMatchObject({ phase: 'choose', needsDiskGB: 4.44 })
    free = 200
    await c.retry()
    expect(c.state).toMatchObject({ phase: 'choose', needsDiskGB: 0 })
  })
})
