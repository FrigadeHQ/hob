import { describe, expect, it } from 'vitest'
import { pick } from '../src/pick'
import { machines, models } from './fixtures'

const id = (c?: { model: { id: string } } | null) => c?.model.id

describe('pick', () => {
  it('lists models that cannot run, with why (M1 Max 32GB: 120B needs more memory)', () => {
    const r = pick(machines.m1max32, models)
    expect(r.unavailable.find((u) => u.model.id === 'gpt-oss-120b')).toMatchObject({ reason: 'memory' })
    // every catalog model is either selectable or unavailable, never both
    const selectable = new Set([...r.all, ...(r.smarter ? [r.smarter] : [])].map((c) => c.model.id))
    for (const u of r.unavailable) expect(selectable.has(u.model.id)).toBe(false)
    expect(selectable.size + r.unavailable.length).toBe(models.length)
  })
  it('a model that fits but would be painfully slow is unavailable for speed', () => {
    const r = pick(machines.cpu32, models)
    expect(r.unavailable.some((u) => u.reason === 'slow')).toBe(true)
  })
  it('M1 Max 32GB (no graphics card, ≤ 32 GB) → gpt-oss 20B, not lite', () => {
    const r = pick(machines.m1max32, models)
    expect(id(r.recommended)).toBe('gpt-oss-20b')
    expect(r.liteMode).toBe(false)
    expect(r.recommended!.estTokPerSec).toBeGreaterThan(15)
  })
  it('M4 Max 128GB → biggest model', () => {
    expect(id(pick(machines.m4max128, models).recommended)).toBe('gpt-oss-120b')
  })
  it('RTX 3060 12GB, 16GB RAM → gpt-oss 20B split between card and memory, full context', () => {
    const r = pick(machines.linux3060, models)
    expect(id(r.recommended)).toBe('gpt-oss-20b')
    expect(r.recommended!.contextSize).toBe(16384)
    expect(r.recommended!.device).toBe('split')
    expect(r.recommended!.estTokPerSec).toBeGreaterThan(30)
  })
  it('8GB laptop, no GPU → starter-size model, lite mode', () => {
    const r = pick(machines.winLaptop8, models)
    expect(id(r.recommended)).toBe('qwen3-1.7b')
    expect(r.liteMode).toBe(true)
  })
  it('CPU-only 32GB → MoE wins on CPU', () => {
    const r = pick(machines.cpu32, models)
    expect(id(r.recommended)).toBe('gpt-oss-20b')
    expect(r.recommended!.device).toBe('cpu')
  })
  describe('graphics cards: the engine puts what fits on the card and the rest in memory', () => {
    it('RTX 4060 8GB, 16GB RAM → gpt-oss 20B split, not an 8B squeezed onto the card', () => {
      const r = pick(machines.rtx4060_16, models)
      expect(id(r.recommended)).toBe('gpt-oss-20b')
      expect(r.recommended!.device).toBe('split')
      expect(r.liteMode).toBe(false)
    })
    it('RTX 3060 12GB, 32GB RAM → the best model, split; no gpt-oss rule with a graphics card', () => {
      const r = pick(machines.rtx3060_32, models)
      expect(id(r.recommended)).toBe('qwen3.6-35b-a3b')
      expect(r.recommended!.device).toBe('split')
      expect(r.recommended!.estTokPerSec).toBeGreaterThanOrEqual(15)
    })
    it('RTX 4090 24GB → best model mostly on the card, much faster than on the processor', () => {
      const r = pick(machines.rtx4090_64, models)
      expect(id(r.recommended)).toBe('qwen3.6-35b-a3b')
      expect(r.recommended!.estTokPerSec).toBeGreaterThan(60)
    })
    it('RTX 5090 32GB → best model fully on the card', () => {
      const r = pick(machines.rtx5090_64, models)
      expect(id(r.recommended)).toBe('qwen3.6-35b-a3b')
      expect(r.recommended!.device).toBe('gpu')
    })
  })
  it('gpt-oss is preferred only without a graphics card and up to 32 GB, and only when it fits', () => {
    // a graphics card or more memory: best score wins as usual
    expect(id(pick(machines.rtx3060_32, models).recommended)).toBe('qwen3.6-35b-a3b')
    expect(id(pick(machines.m4max128, models).recommended)).toBe('gpt-oss-120b')
    // too little memory for it: the usual pick
    expect(id(pick(machines.m1_16, models).recommended)).toBe('qwen3-4b')
  })
  it('base M1 16GB → small model, slower big ones offered as smarter', () => {
    const r = pick(machines.m1_16, models)
    expect(id(r.recommended)).toBe('qwen3-4b')
    expect(r.liteMode).toBe(true)
    expect(r.smarter && r.smarter.model.agentScore).toBeGreaterThan(4)
  })
  it('nothing fits → recommended null, no crash', () => {
    const r = pick(machines.tiny4, models)
    expect(r.recommended).toBeNull()
    expect(r.all).toEqual([])
  })
  it('flags missing disk space', () => {
    const r = pick({ ...machines.m1max32, freeDiskGB: 20 }, models)
    expect(r.recommended!.needsDiskGB).toBeCloseTo(12.11 + 10 - 20, 1)
  })
  it('starter is the smallest starter model that fits', () => {
    expect(id(pick(machines.m1max32, models).starter)).toBe('qwen3-1.7b')
  })
  it('faster alternative is meaningfully faster than recommended', () => {
    const r = pick(machines.m4max128, models)
    expect(r.faster).toBeDefined()
    expect(r.faster!.estTokPerSec).toBeGreaterThan(r.recommended!.estTokPerSec * 1.5)
  })
})

describe('pick ranking', () => {
  it('equal agent score: full-context model beats one squeezed to 8k', () => {
    const r = pick(machines.m1max32, models)
    const dense = r.all.find((c) => c.model.id === 'qwen3-32b')
    expect(dense?.contextSize).toBe(8192)
    expect(r.recommended!.contextSize).toBe(16384)
  })
})
