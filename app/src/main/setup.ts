import { pick, type Catalog, type Choice, type Hardware, type PickResult } from '@hob/picker'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { ChecksumError, DiskSpaceError, ensureModelFile, fileNameFor, isVerified, partialDownloadGB, type DownloadDeps, type Progress } from './downloader'
import { InsufficientMemoryError, type Engine } from './engine'
import { loadSettings, updateSettings } from './settings'
import type { ModelOption, ModelSummary, SetupState } from '../shared/types'
import type { ModelRow } from '../shared/agent'

export type SetupDeps = {
  engine: Engine
  getHardware(): Promise<Hardware>
  getCatalog(): Promise<Catalog>
  modelsDir: string
  settingsPath: string
  download: DownloadDeps
  /** fake mode only: treat every file as having this hash */
  sha256Override?: string
  /** waits between download retries; one retry per entry */
  retryDelaysMs?: number[]
}

const DISK_HEADROOM_GB = 10
const LITE_AGENT_SCORE = 5

const blurb = (tps: number) => (tps >= 40 ? 'very fast' : tps >= 20 ? 'fast' : 'steady')
export const summarize = (c: Choice): ModelSummary => ({
  id: c.model.id, name: c.model.name, sizeGB: c.build.sizeGB, estTokPerSec: c.estTokPerSec, blurb: blurb(c.estTokPerSec),
})

/** "Apple M3 Pro with 36 GB of memory", "NVIDIA GeForce RTX 4070 (12 GB) and 32 GB of memory" */
export function computerName(hw: Hardware): string {
  const ram = `${Math.round(hw.totalRamGB)} GB of memory`
  if (hw.gpu.kind === 'discrete' && hw.gpu.name) return `${hw.gpu.name}${hw.gpu.vramGB ? ` (${Math.round(hw.gpu.vramGB)} GB)` : ''} and ${ram}`
  const chip = (hw.gpu.kind === 'unified' && hw.gpu.name ? hw.gpu.name : hw.cpuModel)
    .replace(/\((R|TM)\)/g, '').replace(/\s+CPU\b.*$/, '').replace(/\s+@.*$/, '').replace(/\s+/g, ' ').trim()
  return chip && chip !== 'unknown' ? `${chip} with ${ram}` : `${ram}`
}

/** Plain-English message for anything that can go wrong during setup. */
export function friendly(err: unknown): string {
  if (err instanceof DiskSpaceError) return err.message
  if (err instanceof ChecksumError) return 'The download was corrupted. Try again.'
  const msg = err instanceof Error ? err.message : String(err)
  if (/fetch failed|ENOTFOUND|ECONN|ETIMEDOUT|EAI_AGAIN|network|socket/i.test(msg)) {
    return 'Download interrupted. Check your connection and try again.'
  }
  return "Setup didn't finish. Try again."
}

export class SetupController {
  private _state: SetupState = { phase: 'probing' }
  private listeners = new Set<(s: SetupState) => void>()
  private result: PickResult | undefined
  /** true while start/install/recover runs; guards double-clicks and overlapping flows */
  private busy = false
  /** model currently loaded in the engine */
  private active: Choice | undefined
  /** target whose download failed while the user kept chatting on the starter */
  private pendingTarget: Choice | undefined

  constructor(private deps: SetupDeps) {
    deps.engine.onExit(() => void this.recover())
  }

  get state() { return this._state }
  get engine() { return this.deps.engine }
  onState(cb: (s: SetupState) => void) { this.listeners.add(cb); return () => this.listeners.delete(cb) }
  private set(s: SetupState) { this._state = s; for (const l of this.listeners) l(s) }

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
      this.set({ phase: 'probing' })
      try {
        const [hw, catalog] = await Promise.all([this.deps.getHardware(), this.deps.getCatalog()])
        this.result = pick(hw, catalog.models)
        const r = this.result
        if (!r.recommended) return this.set({ phase: 'error', message: 'Hob needs at least 8 GB of memory to run on this computer.' })

        const settings = loadSettings(this.deps.settingsPath)
        const pending = this.choices().find((c) => c.model.id === settings.pendingModelId)
        if (pending) return await this.install(pending)
        const savedChoice = this.choices().find((c) => c.model.id === settings.activeModelId)
        if (savedChoice && this.verified(savedChoice)) return await this.loadWithFallback(savedChoice)

        this.set({
          phase: 'choose', recommended: summarize(r.recommended), models: this.modelOptions(), liteMode: r.liteMode, needsDiskGB: r.recommended.needsDiskGB,
          computer: computerName(hw), ...(r.starter && r.starter.model.id !== r.recommended.model.id ? { starter: summarize(r.starter) } : {}),
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

  private async install(target: Choice) {
    const summary = summarize(target)
    const dir = this.deps.modelsDir
    try {
      const starter = this.starter
      // first run only: while switching models later, the current one keeps chat working
      const useStarter = !this.active && !!starter && starter.model.id !== target.model.id && !this.verified(target)

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
          await this.deps.engine.load(p, starter!.contextSize)
          this.active = starter!
        } catch {
          // The starter is only a convenience; carry on without it.
        }
      }
      // remembered so quitting mid-download resumes on the next launch
      updateSettings(this.deps.settingsPath, { pendingModelId: target.model.id })
      const progress = ({ fraction, etaSec }: Progress) =>
        this.set({ phase: 'downloading', target: summary, progress: fraction, etaSec, chatReady: !!this.active })
      progress({ fraction: 0, etaSec: 0 })
      await this.fetch(target, progress)
      await this.loadWithFallback(target)
      this.pendingTarget = undefined
    } catch (err) {
      if (this.active) {
        this.pendingTarget = target
        this.set({ phase: 'ready', model: summarize(this.active), liteMode: this.active.model.agentScore < LITE_AGENT_SCORE, note: friendly(err), canRetry: true })
      } else {
        this.set({ phase: 'error', message: friendly(err) })
      }
    }
  }

  /** Download (or reuse) a verified model file, retrying transient failures. */
  private async fetch(c: Choice, onProgress?: (p: Progress) => void): Promise<string> {
    const delays = this.deps.retryDelaysMs ?? [2000, 8000]
    for (let attempt = 0; ; attempt++) {
      try {
        return await ensureModelFile({ url: c.build.url, sha256: this.sha(c), sizeGB: c.build.sizeGB, dir: this.deps.modelsDir, onProgress }, this.deps.download)
      } catch (err) {
        if (err instanceof DiskSpaceError || err instanceof ChecksumError || attempt >= delays.length) throw err
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

  /** Load `first`; on out-of-memory, fall back to smaller models (downloading if needed). */
  private async loadWithFallback(first: Choice) {
    const pool = [...(this.result?.all ?? []), ...(this.starter ? [this.starter] : [])]
    const smaller = pool
      .filter((c, i, a) => a.findIndex((x) => x.model.id === c.model.id) === i && c.model.id !== first.model.id && c.build.sizeGB < first.build.sizeGB)
      .sort((a, b) => b.build.sizeGB - a.build.sizeGB)
    for (const [i, c] of [first, ...smaller].entries()) {
      try {
        let onProgress: ((p: Progress) => void) | undefined
        if (i > 0 && !this.verified(c)) {
          await this.ensureStarterLoaded()
          onProgress = ({ fraction, etaSec }) =>
            this.set({ phase: 'downloading', target: summarize(c), progress: fraction, etaSec, chatReady: this.starterActive, note: 'Switching to a lighter model…' })
          onProgress({ fraction: 0, etaSec: 0 })
        }
        const p = await this.fetch(c, onProgress)
        this.active = undefined
        await this.deps.engine.load(p, c.contextSize)
        this.active = c
        updateSettings(this.deps.settingsPath, { activeModelId: c.model.id, pendingModelId: undefined })
        return this.set({
          phase: 'ready', model: summarize(c), liteMode: c.model.agentScore < LITE_AGENT_SCORE,
          ...(i > 0 ? { note: 'Ready · lighter model' } : {}),
        })
      } catch (err) {
        if (!(err instanceof InsufficientMemoryError)) throw err
      }
    }
    throw new Error('No model could be loaded on this computer')
  }

  /** The engine process died: bring the active model back. */
  private recover() {
    const s = this._state
    const active = this.active
    if (s.phase !== 'ready' || !active) return
    return this.exclusive(async () => {
      this.set({ ...s, note: 'Restarting…' })
      try {
        await this.loadWithFallback(active)
      } catch (err) {
        this.set({ phase: 'error', message: friendly(err) })
      }
    })
  }
}
