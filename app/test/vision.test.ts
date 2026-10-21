import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { pickVision, VISION_MODELS, visionFitsGpu } from '../src/main/vision/catalog'
import { VisionInstaller } from '../src/main/vision/install'
import { VisionServer } from '../src/main/vision/server'

const fixture = join(import.meta.dirname, 'fixtures/fake-llama-server.mjs')

it('runs fully on the graphics chip only when it fits next to the main model', () => {
  // a 34 GB Mac: next to gpt-oss (13 GB) yes, next to Qwen3.6 35B (22 GB) no
  expect(visionFitsGpu({ totalRamGB: 34.4, unified: true, mainModelGB: 13, visionGB: 2.9 })).toBe(true)
  expect(visionFitsGpu({ totalRamGB: 34.4, unified: true, mainModelGB: 22, visionGB: 2.9 })).toBe(false)
  // a separate graphics card: its own memory counts
  expect(visionFitsGpu({ totalRamGB: 64, unified: false, vramGB: 12, mainModelGB: 9, visionGB: 2.9 })).toBe(false)
  expect(visionFitsGpu({ totalRamGB: 64, unified: false, vramGB: 24, mainModelGB: 9, visionGB: 2.9 })).toBe(true)
})

it('picks the 4B vision model when it fits on the graphics chip next to the main model, else the faster-on-CPU 2B', () => {
  expect(pickVision({ totalRamGB: 34.4, unified: true, mainModelGB: 13 }).id).toBe('qwen3-vl-4b')
  expect(pickVision({ totalRamGB: 34.4, unified: true, mainModelGB: 22 }).id).toBe('qwen3-vl-2b')
  expect(pickVision({ totalRamGB: 16, unified: true, mainModelGB: 5 }).id).toBe('qwen3-vl-4b')
  expect(pickVision({ totalRamGB: 16, unified: true, mainModelGB: 8 }).id).toBe('qwen3-vl-2b')
})

describe('VisionInstaller', () => {
  function world(over: Partial<ConstructorParameters<typeof VisionInstaller>[1]> = {}) {
    const root = mkdtempSync(join(tmpdir(), 'garth-vision-'))
    const fetched: string[] = []; const states: unknown[] = []
    const inst = new VisionInstaller(root, {
      platformKey: 'darwin-arm64', choose: async () => VISION_MODELS['4b'],
      download: { download: async (_u, dir, name) => { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, name), 'x') }, hashFile: async () => 'h', freeDiskGB: async () => 500 },
      sha256Override: 'h',
      fetchFile: async (url, _sha, _gb, dir, _p, name) => { fetched.push(url); mkdirSync(dir, { recursive: true }); const p = join(dir, name ?? 'f'); writeFileSync(p, 'tgz'); return p },
      exec: async (_cmd, args) => { const out = args[args.indexOf('-C') + 1]; mkdirSync(join(out, 'llama-b11433'), { recursive: true }); writeFileSync(join(out, 'llama-b11433', 'llama-server'), '') },
      ...over,
    }, (s) => states.push(s))
    return { root, inst, fetched, states }
  }

  it('downloads the model, its image file and the server once, then reports ready', async () => {
    const { inst, fetched, states } = world()
    expect(inst.state).toEqual({ phase: 'off' })
    await inst.ensure()
    expect(inst.state).toMatchObject({ phase: 'ready', name: 'Qwen3-VL 4B' })
    expect(states.some((s) => (s as { phase: string }).phase === 'downloading')).toBe(true)
    expect(existsSync(inst.modelPath)).toBe(true)
    expect(existsSync(inst.mmprojPath)).toBe(true)
    expect(await inst.serverBinary()).toMatch(/llama-server$/)
    expect(fetched).toHaveLength(1)
    await inst.ensure()
    expect(fetched).toHaveLength(1)
  })

  it('a failed download is an error state, and trying again works', async () => {
    let fail = true
    const { inst } = world({ fetchFile: async (url, _s, _g, dir, _p, name) => { if (fail) throw new Error('fetch failed'); mkdirSync(dir, { recursive: true }); const p = join(dir, name ?? 'f'); writeFileSync(p, ''); return p } })
    await inst.ensure().catch(() => {})
    expect(inst.state).toMatchObject({ phase: 'error' })
    fail = false
    await inst.ensure()
    expect(inst.state.phase).toBe('ready')
  })
})

describe('VisionServer', () => {
  let srv: VisionServer | undefined
  afterEach(() => srv?.stop())

  it('starts on the first question, answers about the image, and stops when idle', async () => {
    srv = new VisionServer({ command: async () => ({ cmd: process.execPath, args: [fixture] }), model: () => 'm.gguf', mmproj: () => 'p.gguf', idleMs: 300 })
    expect(srv.running).toBe(false)
    const a = await srv.ask('data:image/png;base64,AAAA', 'What is this?')
    expect(a).toContain('saw data:image/png;base64')
    expect(a).toContain('for: What is this?')
    expect(srv.running).toBe(true)
    await new Promise((r) => setTimeout(r, 800))
    expect(srv.running).toBe(false)
    expect(await srv.ask('data:image/png;base64,BBBB', 'Again?')).toContain('Again?')
  })

  it('keeps the model off the graphics chip when the main model leaves too little room', async () => {
    srv = new VisionServer({ command: async () => ({ cmd: process.execPath, args: [fixture] }), model: () => 'm', mmproj: () => 'p', useGpu: async () => false })
    expect(await srv.ask('data:image/png;base64,AAAA', 'q')).toContain('gpu=0')
  })

  it('gives up with a plain message when an answer takes too long', async () => {
    process.env.FAKE_LLAMA_SLOW = '1500'
    try {
      srv = new VisionServer({ command: async () => ({ cmd: process.execPath, args: [fixture] }), model: () => 'm', mmproj: () => 'p', answerMs: 300 })
      await expect(srv.ask('data:image/png;base64,AAAA', 'q')).rejects.toThrow(/took too long/)
    } finally { delete process.env.FAKE_LLAMA_SLOW }
  })

  it('falls back to the CPU build when the graphics build will not start', async () => {
    process.env.FAKE_LLAMA_FAIL_GPU = '1'
    try {
      srv = new VisionServer({ command: async () => ({ cmd: process.execPath, args: [fixture] }), cpuCommand: async () => ({ cmd: process.execPath, args: [fixture] }), model: () => 'm', mmproj: () => 'p' })
      expect(await srv.ask('data:image/png;base64,AAAA', 'q')).toContain('gpu=0')
    } finally { delete process.env.FAKE_LLAMA_FAIL_GPU }
  })
})

it('model files are pinned to exact revisions and checksums', () => {
  for (const m of Object.values(VISION_MODELS)) for (const f of [m.model, m.mmproj]) {
    expect(f.url).toMatch(/\/resolve\/[0-9a-f]{40}\//)
    expect(f.sha256).toMatch(/^[0-9a-f]{64}$/)
  }
})

describe('look_at_image', () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d605bb0000000049454e44ae426082', 'hex')
  async function ctx(state: import('../src/shared/types').VisionState = { phase: 'ready', name: 'Qwen3-VL 4B', sizeGB: 3 }) {
    const { lookAtImage } = await import('../src/main/tools/vision')
    const chatDir = mkdtempSync(join(tmpdir(), 'garth-look-'))
    writeFileSync(join(chatDir, 'receipt.png'), png)
    const asked: [string, string][] = []
    const c = { chatDir, runTmp: join(chatDir, '.tmp'), signal: new AbortController().signal, vision: { state: () => state, ask: async (img: string, q: string) => { asked.push([img, q]); return 'A receipt from Joe’s Cafe. Total: $23.40.' } } } as never
    return { lookAtImage, c, chatDir, asked }
  }
  it('sends the image and question to the vision model and returns what it saw', async () => {
    const { lookAtImage, c, chatDir, asked } = await ctx()
    expect(lookAtImage.title({ path: 'receipt.png' })).toBe('Looked at receipt.png')
    expect(lookAtImage.action({ path: 'receipt.png' }, c)).toEqual({ kind: 'read', paths: [join(chatDir, 'receipt.png')] })
    const out = await lookAtImage.run({ path: 'receipt.png', question: "What's the total?" }, c)
    expect(out.text).toContain('$23.40')
    expect(asked[0][0]).toMatch(/^data:image\/png;base64,/)
    expect(asked[0][1]).toBe("What's the total?")
  })
  it('says plainly when image support is still downloading or the file is not an image', async () => {
    const { lookAtImage, c } = await ctx({ phase: 'downloading', progress: 0.4 })
    const out = await lookAtImage.run({ path: 'receipt.png' }, c)
    expect(out.failed).toBe(true)
    expect(out.text).toMatch(/40%/)
    const r = await ctx()
    writeFileSync(join(r.chatDir, 'notes.txt'), 'hi')
    expect((await r.lookAtImage.run({ path: 'notes.txt' }, r.c)).failed).toBe(true)
  })
})

it('reads pixel sizes from image headers', async () => {
  const { imageSize } = await import('../src/main/tools/vision')
  const { readFileSync } = await import('node:fs')
  expect(imageSize(readFileSync(join(import.meta.dirname, '../../docs/assets/screenshot.png')))?.w).toBeGreaterThan(768)
  expect(imageSize(Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex'))).toEqual({ w: 1, h: 1 })
})

it.runIf(process.platform === 'darwin')('a big photo is shrunk to 768 px before the vision model sees it', async () => {
  const { lookAtImage, MAX_SIDE } = await import('../src/main/tools/vision')
  const { copyFileSync, readFileSync } = await import('node:fs')
  const { imageSize } = await import('../src/main/tools/vision')
  const chatDir = mkdtempSync(join(tmpdir(), 'garth-look-'))
  copyFileSync(join(import.meta.dirname, '../../docs/assets/screenshot.png'), join(chatDir, 'big.png'))
  let sent = ''
  const c = { chatDir, runTmp: join(chatDir, '.tmp'), signal: new AbortController().signal, vision: { state: () => ({ phase: 'ready', name: 'x', sizeGB: 1 }), ask: async (img: string) => { sent = img; return 'ok' } } } as never
  await lookAtImage.run({ path: 'big.png' }, c)
  expect(sent).toMatch(/^data:image\/jpeg;base64,/)
  const size = imageSize(Buffer.from(sent.split(',')[1], 'base64'))!
  expect(Math.max(size.w, size.h)).toBeLessThanOrEqual(MAX_SIDE)
  expect(readFileSync(join(chatDir, 'big.png')).length).toBeGreaterThan(0)
})
