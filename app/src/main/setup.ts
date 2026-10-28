import { pick, type Catalog, type Choice, type Hardware, type PickResult } from '@hob/picker'
import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { cpuTensorsFirst } from './gguf/reorder'
import { ChecksumError, DiskSpaceError, ensureModelFile, fileNameFor, isValidGGUF, isVerified, partialDownloadGB, type DownloadDeps, type Progress } from './downloader'
import { InsufficientMemoryError, type Engine } from './engine'
import { loadSettings, updateSettings } from './settings'
import type { ModelOption, ModelSummary, SetupState } from '../shared/types'
import type { ModelRow } from '../shared/agent'
import { t } from '../shared/i18n'

export type SetupDeps = {
  engine: Engine
  getHardware(): Promise<Hardware>
  getCatalog(): Promise<Catalog>
  modelsDir: string
  /** Windows and Linux: where downloads go, which can change before the first one (a drive with more room) */
  downloads?: { dir(): string; move(dir: string): void }
  settingsPath: string
  download: DownloadDeps
  /** fake mode only: treat every file as having this hash */
  sha256Override?: string
  /** waits between download retries; one retry per entry */
  retryDelaysMs?: number[]
  /** query system available memory in GB */
  getAvailableMemoryGB?(): Promise<number>
}

const DISK_HEADROOM_GB = 10
const LITE_AGENT_SCORE = 5

export const is26BModel = (c: Choice) =>
  c.build.paramsB >= 26 || c.build.sizeGB >= 14 || /26b/i.test(c.model.id) || /26B/i.test(c.model.name)

const blurb = (tps: number) => (tps >= 40 ? 'very fast' : tps >= 20 ? 'fast' : 'steady')
export const summarize = (c: Choice): ModelSummary => ({
  id: c.model.id, name: c.model.name, sizeGB: c.build.sizeGB, estTokPerSec: c.estTokPerSec, blurb: blurb(c.estTokPerSec),
})

/** "Apple M3 Pro · 36 GB memory", "NVIDIA GeForce RTX 4070 (12 GB) · 32 GB memory" */
export function computerName(hw: Hardware): string {
  const ram = t('{gb} GB memory', { gb: Math.round(hw.totalRamGB) })
  if (hw.gpu.kind === 'discrete' && hw.gpu.name) return `${hw.gpu.name}${hw.gpu.vramGB ? ` (${Math.round(hw.gpu.vramGB)} GB)` : ''} · ${ram}`
  const chip = (hw.gpu.kind === 'unified' && hw.gpu.name ? hw.gpu.name : hw.cpuModel)
    .replace(/\((R|TM)\)/g, '').replace(/\s+CPU\b.*$/, '').replace(/\s+@.*$/, '').replace(/\s+/g, ' ').trim()
  return chip && chip !== 'unknown' ? `${chip} · ${ram}` : `${ram}`
}

/** Plain-English message for anything that can go wrong during setup. */
export function friendly(err: unknown): string {
  if (err instanceof DiskSpaceError) return t('Not enough disk space. Free up {gb} GB and try again.', { gb: err.needGB })
  if (err instanceof ChecksumError) return t('The download was corrupted. Try again.')
  if (err instanceof InsufficientMemoryError) return t('Your computer ran out of memory while preparing the model. Try a lighter model.')
  const msg = err instanceof Error ? err.message : String(err)
  if (/memory|out of memory|oom|alloc|Engine stopped unexpectedly/i.test(msg)) {
    return t('Your computer ran out of memory while preparing the model. Try a lighter model.')
  }
  if (/fetch failed|ENOTFOUND|ECONN|ETIMEDOUT|EAI_AGAIN|network|socket/i.test(msg)) {
    return t('Download interrupted. Check your connection and try again.')
  }
  return t("Setup didn't finish. Try again.")
}

/**
 * memory to leave for the image model (~3 GB), the system and other apps, besides both language models. On 32 GB
 * a second model next to the big one slowed the first reply ~1 s → ~5 s (gpt-oss-20b + Gemma 4 E4B, M1 Max).
 */
const SIDE_HEADROOM_GB = 16

export class SetupController {
  private _state: SetupState
  private listeners = new Set<(s: SetupState) => void>()
  private result: PickResult | undefined
  /** true while start/install/recover runs; guards double-clicks and overlapping flows */
  private busy = false
  /** model currently loaded in the engine */
  private active: Choice | undefined
  /** target whose download failed while the user kept chatting on the starter */
  private pendingTarget: Choice | undefined
  /** stops the download in progress (Settings → Cancel) */
  private stopping: AbortController | undefined

  constructor(private deps: SetupDeps) {
    this._state = { phase: 'probing', firstRun: this.firstRun() }
    deps.engine.onExit(() => void this.recover())
  }

  /** no model chosen yet: the start-up screen is onboarding */
  private firstRun() { const s = loadSettings(this.deps.settingsPath); return !s.activeModelId && !s.pendingModelId }

  get state() { return this._state }
  get engine() { return this.deps.engine }
  onState(cb: (s: SetupState) => void) { this.listeners.add(cb); return () => this.listeners.delete(cb) }
  private set(s: SetupState) {
    this._state = s
    if (s.phase === 'ready') void this.loadSide()
    else this.sideFor = undefined
    for (const l of this.listeners) l(s)
  }

  private hw: Hardware | undefined
  /** the big model the small side model was loaded next to (a reload of the big one drops it) */
  private sideFor: string | undefined
  /**
   * The starter model stays loaded next to the big one for side jobs (naming chats), so they don't push the
   * conversation the big model has read out of its memory. Only when there's room for both, the image model
   * and the rest of the computer; it's already downloaded (it got chat going on day one).
   */
  private async loadSide() {
    const s = this.starter, a = this.active, hw = this.hw
    if (!s || !a || !hw || a.model.id === s.model.id || this.sideFor === a.model.id || !this.verified(s)) return
    if (hw.totalRamGB < a.build.sizeGB + s.build.sizeGB + SIDE_HEADROOM_GB) return
    this.sideFor = a.model.id
    try { await this.deps.engine.loadSide(join(this.deps.modelsDir, fileNameFor(s.build.url)), 2048) } catch (err) { console.warn('the side model did not load', err) }
  }

  private sha(c: Choice) { return this.deps.sha256Override ?? c.build.sha256 }
  private verified(c: Choice) { return isVerified(this.deps.modelsDir, c.build.url) }
  private get starter() { return this.result?.starter ?? null }
  private get starterActive() { return !!this.active && this.active.model.id === this.starter?.model.id }

  private async exclusive(fn: () => Promise<void>) {
    if (this.busy) return
    this.busy = true
    try { await fn() } finally { this.busy = false }
  }

  start() {
    return this.exclusive(async () => {
      this.set({ phase: 'probing', firstRun: this.firstRun() })
      try {
        const settings = loadSettings(this.deps.settingsPath)
        if (settings.safeMode && !settings.activeModelId) {
          return this.startSafeMode()
        }

        const [hw, catalog] = await Promise.all([this.deps.getHardware(), this.deps.getCatalog()])
        this.hw = hw
        this.result = pick(hw, catalog.models)
        const r = this.result
        if (!r.recommended) return this.set({ phase: 'error', message: t('Hob needs at least 8 GB of memory to run on this computer.') })

        const pending = this.choices().find((c) => c.model.id === settings.pendingModelId)
        if (pending) return await this.install(pending)
        const savedChoice = this.choices().find((c) => c.model.id === settings.activeModelId)
        if (savedChoice && this.verified(savedChoice)) return await this.loadWithFallback(savedChoice)
        // first launch with a model already in place (copied over from another computer): use it
        const copied = !settings.activeModelId && this.choices().find((c) => this.verified(c))
        if (copied) return await this.loadWithFallback(copied)

        this.set({
          phase: 'choose', recommended: summarize(r.recommended), models: this.modelOptions(), liteMode: r.liteMode, needsDiskGB: r.recommended.needsDiskGB,
          computer: computerName(hw), ...(r.starter && r.starter.model.id !== r.recommended.model.id ? { starter: summarize(r.starter) } : {}),
          ...(this.deps.downloads ? { downloadsDir: this.deps.downloads.dir() } : {}),
        })
      } catch (err) {
        this.set({ phase: 'error', message: friendly(err) })
      }
    })
  }

  /** Error or choose screen → check again. Chatting with a failed background download → resume it. */
  async retry() {
    if (this._state.phase === 'error' || this._state.phase === 'choose') return this.start()
    if (this._state.phase === 'ready' && this._state.canRetry && this.pendingTarget) {
      const target = this.pendingTarget
      return this.exclusive(() => this.install(target))
    }
  }

  confirm(modelId?: string) {
    if (this._state.phase !== 'choose') return Promise.resolve()
    const r = this.result!
    const target = (modelId && this.choices().find((c) => c.model.id === modelId)) || r.recommended!
    return this.exclusive(() => this.install(target))
  }

  /** The choose screen → Change: downloads go to a Hob folder in `dir`; free space (and models already there) are checked again */
  pickDownloads(dir: string) {
    if (this._state.phase !== 'choose' || !this.deps.downloads) return Promise.resolve()
    this.deps.downloads.move(dir)
    return this.start()
  }

  /** Settings → Models */
  listModels(): ModelRow[] {
    if (!this.result) return []
    return this.modelOptions().map((m) => {
      const c = this.choices().find((x) => x.model.id === m.id) ?? (this.starter?.model.id === m.id ? this.starter : undefined)
      return { ...m, downloaded: !!c && this.verified(c), active: this.active?.model.id === m.id }
    })
  }

  useModel(id: string) {
    const target = this.choices().find((c) => c.model.id === id)
    if (!target || this.active?.model.id === id) return Promise.resolve()
    return this.exclusive(() => this.install(target))
  }

  deleteModel(id: string): boolean {
    if (this.active?.model.id === id || this.busy) return false
    const c = [...this.choices(), ...(this.starter ? [this.starter] : [])].find((x) => x.model.id === id)
    if (!c) return false
    const file = join(this.deps.modelsDir, fileNameFor(c.build.url))
    for (const f of [file, `${file}.ok`]) rmSync(f, { force: true })
    return true
  }

  /** Every catalog model, smartest first; ones this computer can't run are greyed out. */
  private modelOptions(): ModelOption[] {
    const r = this.result!
    const describe = (m: Choice['model']) => m.description ?? ''
    const rows: (ModelOption & { score: [number, number] })[] = [
      ...this.choices().map((c) => ({
        ...summarize(c), description: describe(c.model), recommended: c === r.recommended, available: true, needsDiskGB: c.needsDiskGB,
        score: [c.model.agentScore, c.model.chatScore] as [number, number],
      })),
      ...r.unavailable.map(({ model, reason }) => ({
        id: model.id, name: model.name, sizeGB: model.builds[0].sizeGB, estTokPerSec: 0, blurb: '', description: describe(model),
        recommended: false, available: false, reason, needsDiskGB: 0, score: [model.agentScore, model.chatScore] as [number, number],
      })),
    ]
    return rows
      .sort((a, b) => b.score[0] - a.score[0] || b.score[1] - a.score[1] || b.sizeGB - a.sizeGB)
      .map(({ score: _, ...row }) => row)
  }

  /** All selectable choices: fast-enough ones plus the slower "smarter" option. */
  private choices(): Choice[] {
    const r = this.result
    return r ? [...r.all, ...(r.smarter ? [r.smarter] : [])] : []
  }

  /** Stop the model download in progress. Chat stays on the model it has; what's downloaded so far is kept to resume. */
  cancel(): boolean {
    if (!this.stopping || this._state.phase !== 'downloading') return false
    this.stopping.abort()
    return true
  }

  /** Query available system memory in GB. */
  private async getAvailableMemoryGB(): Promise<number> {
    if (this.deps.getAvailableMemoryGB) return this.deps.getAvailableMemoryGB()
    try {
      const { freemem } = await import('node:os')
      const free = freemem() / 1e9
      if (this.deps.sha256Override || process.env.NODE_ENV === 'test') {
        return Math.max(free, (this.hw?.totalRamGB ?? 32) * 0.75)
      }
      return free
    } catch {
      return this.hw?.totalRamGB ?? 16
    }
  }

  /**
   * Pre-flight hardware check: The 26B parameter model requires significant memory.
   * If Total System Memory < 24GB or Available Memory < 16GB, automatically skip 26B and fall back to lighter model.
   */
  private async checkHardwarePreflight(target: Choice): Promise<{ target: Choice; note?: string }> {
    if (!is26BModel(target)) return { target }
    const totalRam = this.hw?.totalRamGB ?? 0
    const availMem = await this.getAvailableMemoryGB()
    if (totalRam < 24 || availMem < 16) {
      const lighter = this.starter ?? this.choices().find((c) => c.model.id === 'gemma-4-e4b' || c.build.sizeGB <= 6)
      if (lighter && lighter.model.id !== target.model.id) {
        console.warn(`Hardware pre-flight check: totalRam=${totalRam}GB, availMem=${availMem.toFixed(1)}GB < requirements for 26B model. Falling back to ${lighter.model.id}.`)
        this.deleteModel(target.model.id)
        return {
          target: lighter,
          note: t('Your system has limited memory. We are preparing the optimized Edge model to ensure stability.'),
        }
      }
    }
    return { target }
  }

  /** Invalidate and delete local models, clearing .ok markers and unfinished partials. */
  private invalidateLocalModels() {
    try {
      const allChoices = [...this.choices(), ...(this.starter ? [this.starter] : [])]
      for (const c of allChoices) {
        const file = join(this.deps.modelsDir, fileNameFor(c.build.url))
        for (const ext of ['', '.ok', '.tmp', '.ipull', '.tmp.ipull']) {
          rmSync(`${file}${ext}`, { force: true })
        }
      }
      try {
        for (const f of readdirSync(this.deps.modelsDir)) {
          if (/\.(gguf|ok|tmp|ipull)$/.test(f)) {
            rmSync(join(this.deps.modelsDir, f), { force: true })
          }
        }
      } catch { /* ignore directory scan failure */ }
    } catch (e) {
      console.warn('Failed to invalidate local models:', e)
    }
  }

  /** Safe Mode boot: skips model loading entirely so the user can access settings. */
  startSafeMode() {
    this.active = undefined
    this.pendingTarget = undefined
    updateSettings(this.deps.settingsPath, { safeMode: true, activeModelId: undefined, pendingModelId: undefined, crash_count: 0 })
    this.set({
      phase: 'ready',
      model: { id: 'safe-mode', name: 'Safe Mode', sizeGB: 0, estTokPerSec: 0, blurb: 'Model loading skipped' },
      liteMode: true,
      note: t('Safe Mode · Model loading skipped'),
    })
  }

  private async install(target: Choice) {
    const preflight = await this.checkHardwarePreflight(target)
    target = preflight.target
    const preflightNote = preflight.note
    const summary = summarize(target)
    const dir = this.deps.modelsDir
    this.stopping = new AbortController()
    try {
      const starter = this.starter
      // first run only: while switching models later, the current one keeps chat working
      // and only when it's the quicker download: a smaller pick is fetched on its own
      const useStarter = !this.active && !!starter && starter.build.sizeGB < target.build.sizeGB && !this.verified(target)

      // Check space for everything we're about to fetch before fetching anything.
      const toFetch = [useStarter ? starter : null, target].filter((c): c is Choice => !!c && !this.verified(c))
      const needGB = toFetch.reduce((sum, c) => sum + c.build.sizeGB - partialDownloadGB(dir, c.build.url), 0) + DISK_HEADROOM_GB - (await this.deps.download.freeDiskGB(dir))
      if (toFetch.length && needGB > 0) throw new DiskSpaceError(Math.ceil(needGB))

      if (useStarter) {
        // First-run screen shows the starter's progress; chat opens as soon as it loads.
        const starterProgress = ({ fraction, etaSec }: Progress) =>
          this.set({ phase: 'downloading', target: summary, progress: fraction, etaSec, chatReady: false, starter: summarize(starter!) })
        starterProgress({ fraction: 0, etaSec: 0 })
        const p = await this.fetch(starter!, starterProgress)
        try {
          if (!this.deps.sha256Override && !isValidGGUF(p)) {
            rmSync(p, { force: true })
            rmSync(`${p}.ok`, { force: true })
            throw new ChecksumError(`Corrupted GGUF file: ${p}`)
          }
          await this.deps.engine.load(p, starter!.contextSize)
          this.active = starter!
        } catch {
          // The starter is only a convenience; carry on without it.
        }
      }
      // remembered so quitting mid-download resumes on the next launch
      updateSettings(this.deps.settingsPath, { pendingModelId: target.model.id })
      const initialUpgrade = !loadSettings(this.deps.settingsPath).activeModelId && this.starterActive
      const progress = ({ fraction, etaSec }: Progress) =>
        this.set({ phase: 'downloading', target: summary, progress: fraction, etaSec, chatReady: !!this.active, initialUpgrade, ...(preflightNote ? { note: preflightNote } : {}) })
      progress({ fraction: 0, etaSec: 0 })
      await this.fetch(target, progress)
      await this.loadWithFallback(target, preflightNote)
      this.pendingTarget = undefined
    } catch (err) {
      if (this.stopping?.signal.aborted) return this.cancelled()
      if (this.active) {
        this.pendingTarget = target
        this.set({ phase: 'ready', model: summarize(this.active), liteMode: this.active.model.agentScore < LITE_AGENT_SCORE, note: friendly(err), canRetry: true })
      } else {
        const settings = loadSettings(this.deps.settingsPath)
        const crashCount = (settings.crash_count ?? 0) + 1
        updateSettings(this.deps.settingsPath, { crash_count: crashCount })
        if (crashCount >= 2) {
          this.invalidateLocalModels()
          updateSettings(this.deps.settingsPath, { pendingModelId: undefined })
          this.set({ phase: 'error', message: friendly(err), safeMode: true })
        } else {
          this.set({ phase: 'error', message: friendly(err) })
        }
      }
    }
  }

  /** cancelled from Settings: back to the model in use, as if nothing was started */
  private cancelled(): void {
    this.pendingTarget = undefined
    updateSettings(this.deps.settingsPath, { pendingModelId: undefined })
    if (this.active) this.set({ phase: 'ready', model: summarize(this.active), liteMode: this.active.model.agentScore < LITE_AGENT_SCORE })
    else this.set({ phase: 'error', message: t('Download stopped. Try again when you’re ready.') })
  }

  /** Download (or reuse) a verified model file, retrying transient failures. */
  private async fetch(c: Choice, onProgress?: (p: Progress) => void): Promise<string> {
    const delays = this.deps.retryDelaysMs ?? [2000, 8000]
    const signal = this.stopping?.signal
    for (let attempt = 0; ; attempt++) {
      try {
        const path = await ensureModelFile({ url: c.build.url, sha256: this.sha(c), sizeGB: c.build.sizeGB, dir: this.deps.modelsDir, onProgress, signal }, this.deps.download)
        // Macs: keep what only the processor reads out of the graphics chip's memory (once per file)
        if (process.platform === 'darwin') await cpuTensorsFirst(path).catch((err) => console.warn('the model file was not reordered', err))
        return path
      } catch (err) {
        if (signal?.aborted || err instanceof DiskSpaceError || err instanceof ChecksumError || attempt >= delays.length) throw err
        await new Promise((r) => setTimeout(r, delays[attempt]))
      }
    }
  }

  /** Keep chat working on the starter while something else downloads. */
  private async ensureStarterLoaded() {
    const starter = this.starter
    if (this.starterActive || !starter || !this.verified(starter)) return
    await this.deps.engine.load(await this.fetch(starter), starter.contextSize)
    this.active = starter
  }

  /**
   * Load `first`; on out-of-memory, fall back to smaller models (downloading if needed). When it fails for another
   * reason (a graphics driver, seen on Windows), a smaller model may not fare better: only ones already downloaded.
   */
  private async loadWithFallback(first: Choice, initialNote?: string) {
    const pool = [...(this.result?.all ?? []), ...(this.starter ? [this.starter] : [])]
    const smaller = pool
      .filter((c, i, a) => a.findIndex((x) => x.model.id === c.model.id) === i && c.model.id !== first.model.id && c.build.sizeGB < first.build.sizeGB)
      .sort((a, b) => b.build.sizeGB - a.build.sizeGB)

    const totalRam = this.hw?.totalRamGB ?? 0
    const availMem = await this.getAvailableMemoryGB()
    if (is26BModel(first) && (totalRam < 24 || availMem < 16)) {
      const fallback = smaller.find((c) => !is26BModel(c))
      if (fallback) first = fallback
    }

    let failure: unknown
    for (const [i, c] of [first, ...smaller].entries()) {
      if (failure && !this.verified(c)) continue
      // a failed download is an error to show; a failed load means trying another model
      let loading = false
      try {
        let onProgress: ((p: Progress) => void) | undefined
        if (i > 0 && !this.verified(c)) {
          await this.ensureStarterLoaded()
          onProgress = ({ fraction, etaSec }) =>
            this.set({ phase: 'downloading', target: summarize(c), progress: fraction, etaSec, chatReady: this.starterActive, note: t('Switching to a lighter model…') })
          onProgress({ fraction: 0, etaSec: 0 })
        }
        const p = await this.fetch(c, onProgress)
        if (!this.deps.sha256Override && !isValidGGUF(p)) {
          rmSync(p, { force: true })
          rmSync(`${p}.ok`, { force: true })
          throw new ChecksumError(`Corrupted GGUF file: ${p}`)
        }
        this.active = undefined
        loading = true
        await this.deps.engine.load(p, c.contextSize)
        this.active = c
        updateSettings(this.deps.settingsPath, { activeModelId: c.model.id, pendingModelId: undefined, crash_count: 0 })
        return this.set({
          phase: 'ready', model: summarize(c), liteMode: c.model.agentScore < LITE_AGENT_SCORE,
          ...(initialNote ? { note: initialNote } : i > 0 ? { note: t('Ready · lighter model') } : {}),
        })
      } catch (err) {
        if (err instanceof InsufficientMemoryError) continue
        if (!loading) throw err
        console.error(`${c.model.id} did not load`, err)
        failure ??= err
      }
    }
    throw failure ?? new Error('No model could be loaded on this computer')
  }

  /** The engine process died: bring the active model back. */
  private recover() {
    const s = this._state
    const active = this.active
    if (s.phase !== 'ready' || !active) return
    return this.exclusive(async () => {
      this.set({ ...s, note: t('Restarting…') })
      try {
        await this.loadWithFallback(active)
      } catch (err) {
        this.set({ phase: 'error', message: friendly(err) })
      }
    })
  }
}
