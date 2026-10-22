import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { SpeechModel, WHISPER } from '../src/main/speech'

it('downloads every pinned Whisper file once, verified, into its own folder', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hob-speech-'))
  const got: string[] = []
  const m = new SpeechModel(root, {
    async fetchFile(url, sha, _gb, dir, onProgress, name) {
      expect(url).toContain(WHISPER.revision)
      expect(sha).toMatch(/^[0-9a-f]{64}$/)
      got.push(url.split(`${WHISPER.revision}/`)[1])
      mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, name!), 'x'); onProgress(1)
      return join(dir, name!)
    },
  })
  expect(m.isReady()).toBe(false)
  const progress: number[] = []
  await Promise.all([m.ensure((f) => progress.push(f)), m.ensure()])
  expect(got.sort()).toEqual(WHISPER.files.map((f) => f.path).sort())
  expect(existsSync(join(root, WHISPER.id, 'onnx', 'encoder_model.onnx'))).toBe(true)
  expect(m.isReady()).toBe(true)
  expect(progress.at(-1)).toBe(1)
  await m.ensure()
  expect(got).toHaveLength(WHISPER.files.length)
})

it('asks the system for the mic only when it has never been asked', async () => {
  const { micAccess } = await import('../src/main/speech')
  let asked = 0
  const ask = async () => { asked++; return true }
  expect(await micAccess('granted', ask)).toBe(true)
  expect(await micAccess('denied', ask)).toBe(false)
  expect(asked).toBe(0)
  expect(await micAccess('not-determined', ask)).toBe(true)
  expect(asked).toBe(1)
})
