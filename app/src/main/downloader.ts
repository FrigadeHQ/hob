import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { statfs } from 'node:fs/promises'
import { join } from 'node:path'

export class DiskSpaceError extends Error {
  name = 'DiskSpaceError'
  constructor(public needGB: number) { super(`Not enough disk space. Free up ${needGB} GB and try again.`) }
}
export class ChecksumError extends Error { name = 'ChecksumError' }

export type Progress = { fraction: number; etaSec: number }
export type EnsureOpts = { url: string; sha256: string; sizeGB: number; dir: string; onProgress?: (p: Progress) => void; signal?: AbortSignal }
export type DownloadDeps = {
  download(url: string, dir: string, fileName: string, onProgress: (p: Progress) => void, signal?: AbortSignal): Promise<void>
  hashFile(path: string): Promise<string>
  freeDiskGB(dir: string): Promise<number>
}

const DISK_HEADROOM_GB = 10

const SAFE_NAME = /^[\w.-]+\.gguf$/

/** Local file name for a model URL. Throws on anything that isn't a plain `.gguf` name. */
export function fileNameFor(url: string): string {
  const name = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '')
  if (!SAFE_NAME.test(name) || name.startsWith('.')) throw new Error(`Unsafe model file name: ${name}`)
  return name
}
const marker = (dir: string, url: string) => join(dir, fileNameFor(url) + '.ok')
/** Disk already taken by an unfinished download of this file (it is reused, so it counts toward the need). */
export function partialDownloadGB(dir: string, url: string): number {
  const p = join(dir, fileNameFor(url) + '.ipull')
  try { return (statSync(p).blocks * 512) / 1e9 } catch { return 0 }
}

export const isVerified = (dir: string, url: string) => existsSync(join(dir, fileNameFor(url))) && existsSync(marker(dir, url))

export const STALL_MS = 45_000
export const STALL_TRIES = 5

/**
 * Runs a download, restarting it when no data arrives for stallMs: connections can hang without failing,
 * which would otherwise wait forever. Each restart resumes from the partial file.
 */
export async function retryStalled(
  run: (signal: AbortSignal, progressed: () => void) => Promise<void>,
  o: { stallMs?: number; tries?: number; signal?: AbortSignal } = {},
): Promise<void> {
  const stallMs = o.stallMs ?? STALL_MS
  const tries = o.tries ?? STALL_TRIES
  for (let attempt = 1; ; attempt++) {
    const ac = new AbortController()
    let stalled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const progressed = () => { clearTimeout(timer); timer = setTimeout(() => { stalled = true; ac.abort() }, stallMs) }
    const stop = () => ac.abort()
    o.signal?.addEventListener('abort', stop, { once: true })
    progressed()
    try {
      await run(ac.signal, progressed)
      return
    } catch (err) {
      if (o.signal?.aborted || !stalled) throw err
      if (attempt >= tries) throw new Error('The download stopped receiving data. Check your internet connection and try again.')
    } finally {
      clearTimeout(timer)
      o.signal?.removeEventListener('abort', stop)
    }
  }
}

export const realDeps: DownloadDeps = {
  async download(url, dir, fileName, onProgress, signal) {
    const { createModelDownloader } = await import('node-llama-cpp')
    let last = -1
    await retryStalled(async (attemptSignal, progressed) => {
      const dl = await createModelDownloader({
        modelUri: url, dirPath: dir, fileName, skipExisting: true,
        onProgress: ({ totalSize, downloadedSize, estimatedTimeLeft }) => {
          if (downloadedSize > last) { last = downloadedSize; progressed() }
          onProgress({ fraction: totalSize ? downloadedSize / totalSize : 0, etaSec: Math.round(estimatedTimeLeft / 1000) })
        },
      })
      await dl.download({ signal: attemptSignal })
    }, { signal })
  },
  hashFile: (path) => new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(path).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')))
  }),
  async freeDiskGB(dir) {
    const s = await statfs(dir)
    return (s.bavail * s.bsize) / 1e9
  },
}

export async function ensureModelFile(opts: EnsureOpts, deps: DownloadDeps = realDeps): Promise<string> {
  const fileName = fileNameFor(opts.url)
  const path = join(opts.dir, fileName)
  if (isVerified(opts.dir, opts.url) && readFileSync(marker(opts.dir, opts.url), 'utf8') === opts.sha256) return path

  const free = await deps.freeDiskGB(opts.dir)
  const need = opts.sizeGB - partialDownloadGB(opts.dir, opts.url) + DISK_HEADROOM_GB - free
  if (need > 0) throw new DiskSpaceError(Math.ceil(need))

  for (let attempt = 0; attempt < 2; attempt++) {
    await deps.download(opts.url, opts.dir, fileName, opts.onProgress ?? (() => {}), opts.signal)
    if ((await deps.hashFile(path)) === opts.sha256) {
      writeFileSync(marker(opts.dir, opts.url), opts.sha256)
      return path
    }
    rmSync(path, { force: true })
  }
  throw new ChecksumError(`Download of ${fileName} was corrupted twice`)
}
