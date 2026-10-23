import { describe, expect, it } from 'vitest'
import { pick } from '../src/pick'
import { machines, models } from './fixtures'

const id = (c?: { model: { id: string } } | null) => c?.model.id

describe('pick', () => {
  it('lists models that cannot run, with why (M1 Max 32GB: 120B needs more memory)', () => {
    const r = pick(machines.m1max32, models)
    expect(r.unavailable.find((u) => u.model.id === 'gpt-oss-120b')).toMatchObject({ reason: 'memory' })
    // every catalog model is selectable, unavailable, or not offered here (a last resort or squeezed builds
    // where something better runs), never two of those
    const selectable = new Set([...r.all, ...(r.smarter ? [r.smarter] : [])].map((c) => c.model.id))
    for (const u of r.unavailable) expect(selectable.has(u.model.id)).toBe(false)
    expect(selectable.size + r.unavailable.length).toBe(models.length - 3)
  })
  it('a model that fits but would be painfully slow is unavailable for speed', () => {
    const dense = { ...models[4], id: 'dense-32b', builds: [{ ...models[4].builds[0], sizeGB: 12, paramsB: 32, activeParamsB: 32 }] }
    const r = pick(machines.cpu32, [...models, dense])
    expect(r.unavailable.find((u) => u.model.id === 'dense-32b')?.reason).toBe('slow')
  })
  it('M1 Max 32GB → Gemma 4 26B, not lite', () => {
    const r = pick(machines.m1max32, models)
    expect(id(r.recommended)).toBe('gemma-4-26b-a4b')
    expect(r.liteMode).toBe(false)
    expect(r.recommended!.estTokPerSec).toBeGreaterThan(15)
  })
  it('M4 Max 128GB → biggest model', () => {
    expect(id(pick(machines.m4max128, models).recommended)).toBe('gpt-oss-120b')
  })
  it('RTX 3060 12GB, 16GB RAM → Gemma 4 26B split between card and memory, full context', () => {
    const r = pick(machines.linux3060, models)
    expect(id(r.recommended)).toBe('gemma-4-26b-a4b')
    expect(r.recommended!.contextSize).toBe(16384)
    expect(r.recommended!.device).toBe('split')
    expect(r.recommended!.estTokPerSec).toBeGreaterThan(15)
  })
  it('8GB laptop, no GPU → the last-resort tiny model, lite mode', () => {
    const r = pick(machines.winLaptop8, models)
    expect(id(r.recommended)).toBe('qwen3-1.7b')
    expect(r.liteMode).toBe(true)
  })
  it('CPU-only 32GB → gpt-oss 20B: the fastest on a processor alone (the 26B does not fit, E4B is too slow there)', () => {
    const r = pick(machines.cpu32, models)
    expect(id(r.recommended)).toBe('gpt-oss-20b')
    expect(r.recommended!.device).toBe('cpu')
  })
  describe('graphics cards: the engine puts what fits on the card and the rest in memory', () => {
    it('RTX 4060 8GB, 16GB RAM → Gemma 4 E4B with full context, split', () => {
      const r = pick(machines.rtx4060_16, models)
      expect(id(r.recommended)).toBe('gemma-4-e4b')
      expect(r.recommended!.contextSize).toBe(16384)
      expect(r.liteMode).toBe(false)
    })
    it('RTX 3060 12GB, 32GB RAM → the best model, split', () => {
      const r = pick(machines.rtx3060_32, models)
      expect(id(r.recommended)).toBe('gemma-4-26b-a4b')
      expect(r.recommended!.device).toBe('split')
      expect(r.recommended!.estTokPerSec).toBeGreaterThanOrEqual(15)
    })
    it('RTX 4090 24GB → best model mostly on the card, much faster than on the processor', () => {
      const r = pick(machines.rtx4090_64, models)
      expect(id(r.recommended)).toBe('gemma-4-26b-a4b')
      expect(r.recommended!.estTokPerSec).toBeGreaterThan(60)
    })
    it('RTX 5090 32GB → best model fully on the card', () => {
      const r = pick(machines.rtx5090_64, models)
      expect(id(r.recommended)).toBe('gemma-4-26b-a4b')
      expect(r.recommended!.device).toBe('gpu')
    })
  })
  it('base M1 16GB → Gemma 4 E4B, not lite', () => {
    const r = pick(machines.m1_16, models)
    expect(id(r.recommended)).toBe('gemma-4-e4b')
    expect(r.liteMode).toBe(false)
  })
  it('8GB Mac → Gemma 4 E4B Compact, not E2B', () => {
    const r = pick(machines.mac8, models)
    expect(id(r.recommended)).toBe('gemma-4-e4b-compact')
    expect(r.liteMode).toBe(false)
    expect(r.all.map((c) => c.model.id)).toContain('gemma-4-e2b')
  })
  it('nothing fits → recommended null, no crash', () => {
    const r = pick(machines.tiny4, models)
    expect(r.recommended).toBeNull()
    expect(r.all).toEqual([])
  })
  it('flags missing disk space', () => {
    const r = pick({ ...machines.m1max32, freeDiskGB: 20 }, models)
    expect(r.recommended!.needsDiskGB).toBeCloseTo(14.44 + 10 - 20, 1)
  })
  it('starter is the smallest starter model that fits', () => {
    expect(id(pick(machines.m1max32, models).starter)).toBe('gemma-4-e4b')
  })
  it('faster alternative is meaningfully faster than recommended', () => {
    const r = pick(machines.m4max128, models)
    expect(r.faster).toBeDefined()
    expect(r.faster!.estTokPerSec).toBeGreaterThan(r.recommended!.estTokPerSec * 1.5)
  })
})

describe('pick ranking', () => {
  it('equal agent score: full-context model beats one squeezed to 8k', () => {
    const squeezed = { ...models[4], id: 'squeezed', builds: [{ ...models[4].builds[0], sizeGB: 20.2 }] }
    const r = pick(machines.m1max32, [...models, squeezed])
    expect(r.all.find((c) => c.model.id === 'squeezed')?.contextSize).toBe(8192)
    expect(id(r.recommended)).toBe('gemma-4-26b-a4b')
  })
})

describe('models only for some computers', () => {
  const ids = (r: ReturnType<typeof pick>) => r.all.map((c) => c.model.id)
  it('Qwen3 1.7B only where nothing better fits', () => {
    expect(ids(pick(machines.m3air16, models))).not.toContain('qwen3-1.7b')
    expect(ids(pick(machines.m1max32, models))).not.toContain('qwen3-1.7b')
    expect(pick(machines.winLaptop8, models).recommended?.model.id).toBe('qwen3-1.7b')
  })
  it('E4B Compact is hidden wherever the full E4B runs well', () => {
    for (const hw of [machines.m1_16, machines.m3air16, machines.m1max32]) {
      expect(pick(hw, models).all.map((c) => c.model.id)).not.toContain('gemma-4-e4b-compact')
    }
  })
  it('a 16 GB Mac can try the squeezed Gemma 26B; E4B stays the pick', () => {
    const r = pick(machines.m3air16, models)
    expect(r.recommended?.model.id).toBe('gemma-4-e4b')
    expect(ids(r)).toContain('gemma-4-26b-a4b-compact')
  })
  it('where the full model fits, its squeezed version is not offered', () => {
    const r = pick(machines.m1max32, models)
    expect(ids(r)).toContain('gemma-4-26b-a4b')
    expect(ids(r)).not.toContain('gemma-4-26b-a4b-compact')
    expect(r.unavailable.map((u) => u.model.id)).not.toContain('gemma-4-26b-a4b-compact')
  })
})
