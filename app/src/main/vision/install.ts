import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureModelFile, fileNameFor, type DownloadDeps } from '../downloader'
import type { RuntimeDeps } from '../python/runtime'
import type { VisionState } from '../../shared/types'
import { SERVER_BUILD, SERVER_FILES, VISION_MODELS, type VisionFile, type VisionModel } from './catalog'

export type VisionDeps = {
  /** process.platform-process.arch */
  platformKey: string
  /** which vision model to get (it depends on the main model, so it's asked when the download starts) */
  choose(): Promise<VisionModel>
  /** big model files: resumes and restarts stalled downloads */
  download: DownloadDeps
  /** the small server archive */
  fetchFile: RuntimeDeps['fetchFile']
  /** unpacks archives (tar; on Windows the system's tar.exe, which reads zips too) */
  exec: RuntimeDeps['exec']
  /** fake mode: every file has this hash */
  sha256Override?: string
}

const MARKER = 'ready.json'
const tarCmd = (platformKey: string) => (platformKey.startsWith('win32') ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar')

/** Downloads Mabel's eyes once, into app data: the vision model, its image file and llama.cpp's server. */
export class VisionInstaller {
  private installing: Promise<void> | undefined
  private _state: VisionState
  /** the one installed (or being installed) */
  private chosen: VisionModel | undefined

  constructor(private root: string, private deps: VisionDeps, private onState: (s: VisionState) => void = () => {}) {
    this.chosen = this.installed()
    this._state = this.chosen ? this.ready() : { phase: 'off' }
  }

  get model(): VisionModel {
    if (!this.chosen) throw new Error("Mabel's image support isn't set up yet.")
    return this.chosen
  }

  /** the model a finished install recorded, if its files are still there */
  private installed(): VisionModel | undefined {
    try {
      const m = JSON.parse(readFileSync(join(this.root, MARKER), 'utf8'))
      const model = Object.values(VISION_MODELS).find((v) => v.id === m.model)
      if (!model || m.build !== SERVER_BUILD) return undefined
      const ok = [model.model, model.mmproj].every((f) => existsSync(join(this.modelsDir, fileNameFor(f.url))))
      return ok ? model : undefined
    } catch { return undefined }
  }

  get state() { return this._state }
  get supported() { return !!SERVER_FILES[this.deps.platformKey] }
  private set(s: VisionState) { this._state = s; this.onState(s) }
  private ready(): VisionState { return { phase: 'ready', name: this.model.name, sizeGB: Math.round(((this.model.model.bytes + this.model.mmproj.bytes) / 1e9) * 10) / 10 } }

  private get modelsDir() { return join(this.root, 'models') }
  get modelPath() { return join(this.modelsDir, fileNameFor(this.model.model.url)) }
  get mmprojPath() { return join(this.modelsDir, fileNameFor(this.model.mmproj.url)) }
  private serverDir(cpu: boolean) { return join(this.root, `server-${SERVER_BUILD}${cpu ? '-cpu' : ''}`) }

  isReady(): boolean { return !!this.installed() }

  /** Download what's missing; concurrent callers share one download. */
  ensure(): Promise<void> {
    if (this.isReady()) { this.chosen = this.installed(); if (this._state.phase !== 'ready') this.set(this.ready()); return Promise.resolve() }
    if (!this.supported) return Promise.reject(new Error(`Seeing images isn't available on this computer (${this.deps.platformKey}).`))
    return (this.installing ??= this.install().finally(() => { this.installing = undefined }))
  }

  private async install() {
    this.chosen = await this.deps.choose()
    const files = [this.model.model, this.model.mmproj]
    const server = SERVER_FILES[this.deps.platformKey].gpu
    const total = files.reduce((s, f) => s + f.bytes, 0) + server.bytes
    let done = 0
    const progress = (part: number) => this.set({ phase: 'downloading', progress: Math.min(1, (done + part) / total) })
    try {
      progress(0)
      mkdirSync(this.modelsDir, { recursive: true })
      for (const f of files) {
        await ensureModelFile({ url: f.url, sha256: this.deps.sha256Override ?? f.sha256, sizeGB: f.bytes / 1e9, dir: this.modelsDir, onProgress: ({ fraction }) => progress(fraction * f.bytes) }, this.deps.download)
        done += f.bytes
      }
      await this.unpackServer(server, false, (p) => progress(p * server.bytes))
      writeFileSync(join(this.root, MARKER), JSON.stringify({ model: this.model.id, build: SERVER_BUILD }))
      this.set(this.ready())
    } catch (err) {
      this.set({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
      throw err
    }
  }

  private async unpackServer(f: VisionFile, cpu: boolean, onProgress: (fraction: number) => void = () => {}) {
    const dir = this.serverDir(cpu)
    if (this.findBinary(dir)) return
    const name = f.url.split('/').pop()!
    const archive = await this.deps.fetchFile(f.url, this.deps.sha256Override ?? f.sha256, f.bytes / 1e9, this.root, onProgress, name)
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    await this.deps.exec(tarCmd(this.deps.platformKey), name.endsWith('.zip') ? ['-xf', archive, '-C', dir] : ['-xzf', archive, '-C', dir])
    rmSync(archive, { force: true })
  }

  /** llama-server sits at the top of the archive or one folder down, depending on the build */
  private findBinary(dir: string): string | undefined {
    const exe = this.deps.platformKey.startsWith('win32') ? 'llama-server.exe' : 'llama-server'
    if (!existsSync(dir)) return undefined
    if (existsSync(join(dir, exe))) return join(dir, exe)
    for (const d of readdirSync(dir)) if (existsSync(join(dir, d, exe))) return join(dir, d, exe)
    return undefined
  }

  async serverBinary(): Promise<string> {
    const b = this.findBinary(this.serverDir(false))
    if (!b) throw new Error('The image server is missing. Mabel will download it again.')
    return b
  }

  /** the plain CPU build, for Windows and Linux computers whose graphics drivers can't run the fast one */
  async cpuServerBinary(): Promise<string | undefined> {
    const cpu = SERVER_FILES[this.deps.platformKey]?.cpu
    if (!cpu) return undefined
    await this.unpackServer(cpu, true)
    return this.findBinary(this.serverDir(true))
  }
}
