import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ChecksumError, ensureModelFile, partialDownloadGB, fileNameFor, isVerified, type DownloadDeps } from '../src/main/downloader'

const URL = 'https://huggingface.co/x/y/resolve/main/model-Q4.gguf'
const dir = () => mkdtempSync(join(tmpdir(), 'hob-dl-'))

function deps(over: Partial<DownloadDeps> = {}): DownloadDeps {
  return {
    download: vi.fn(async (_u, d, f, onProgress) => { onProgress({ fraction: 1, etaSec: 0 }); writeFileSync(join(d, f), 'data') }),
    hashFile: vi.fn(async () => 'good'),
    freeDiskGB: vi.fn(async () => 500),
    ...over,
  }
}

describe('ensureModelFile', () => {
  it('counts bytes of a partial download as already-used space when checking disk', async () => {
    const d = dir()
    writeFileSync(join(d, 'model-Q4.gguf.ipull'), Buffer.alloc(64 * 1024))
    const partial = partialDownloadGB(d, URL)
    expect(partial).toBeGreaterThanOrEqual(64 * 1024 / 1e9)
    // free space is short by less than the partial file already holds → still OK
    const dp = deps({ freeDiskGB: vi.fn(async () => 10 + 0.0001 - partial / 2) })
    await expect(ensureModelFile({ url: URL, sha256: 'good', sizeGB: 0.0001, dir: d }, dp)).resolves.toContain('model-Q4.gguf')
  })
  it('derives file name from url', () => {
    expect(fileNameFor(URL)).toBe('model-Q4.gguf')
  })
  it('downloads, verifies, writes .ok marker', async () => {
    const d = dir(); const dp = deps()
    const p = await ensureModelFile({ url: URL, sha256: 'good', sizeGB: 1, dir: d }, dp)
    expect(p).toBe(join(d, 'model-Q4.gguf'))
    expect(isVerified(d, URL)).toBe(true)
  })
  it('skips download and hashing when already verified', async () => {
    const d = dir()
    writeFileSync(join(d, 'model-Q4.gguf'), 'data'); writeFileSync(join(d, 'model-Q4.gguf.ok'), 'good')
    const dp = deps()
    await ensureModelFile({ url: URL, sha256: 'good', sizeGB: 1, dir: d }, dp)
    expect(dp.download).not.toHaveBeenCalled()
    expect(dp.hashFile).not.toHaveBeenCalled()
  })
  it('refuses when disk is too small', async () => {
    const d = dir()
    await expect(ensureModelFile({ url: URL, sha256: 'good', sizeGB: 20, dir: d }, deps({ freeDiskGB: async () => 25 })))
      .rejects.toMatchObject({ name: 'DiskSpaceError', needGB: 5 })
  })
  it('retries once on checksum mismatch, then fails and deletes the file', async () => {
    const d = dir()
    const dp = deps({ hashFile: vi.fn(async () => 'bad') })
    await expect(ensureModelFile({ url: URL, sha256: 'good', sizeGB: 1, dir: d }, dp)).rejects.toBeInstanceOf(ChecksumError)
    expect(dp.download).toHaveBeenCalledTimes(2)
    expect(existsSync(join(d, 'model-Q4.gguf'))).toBe(false)
  })
  it('succeeds if the retry verifies', async () => {
    const d = dir()
    const hashes = ['bad', 'good']
    const dp = deps({ hashFile: vi.fn(async () => hashes.shift()!) })
    await ensureModelFile({ url: URL, sha256: 'good', sizeGB: 1, dir: d }, dp)
    expect(isVerified(d, URL)).toBe(true)
  })
})

describe('fileNameFor safety (I7)', () => {
  it('rejects path traversal in the url', () => {
    expect(() => fileNameFor('https://huggingface.co/x/..%2F..%2Fetc%2Fpasswd')).toThrow()
  })
  it('rejects non-gguf files', () => {
    expect(() => fileNameFor('https://huggingface.co/x/y/notes.txt')).toThrow()
  })
})
