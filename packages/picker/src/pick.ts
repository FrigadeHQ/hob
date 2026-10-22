import { bandwidthGBs } from './bandwidth'
import type { CatalogBuild, CatalogModel, Choice, Hardware, PickResult } from './types'

export const MIN_TOK_PER_SEC = 15
export const LITE_AGENT_SCORE = 5
const SMARTER_MIN_TOK_PER_SEC = 5
const KV_GB_PER_1K = 0.08
const OVERHEAD_GB = 1.5
const DISK_HEADROOM_GB = 10
const EFFICIENCY = 0.75
const CONTEXTS = [16384, 8192]

interface Pool { device: Choice['device']; memGB: number; bw: number; gpuMemGB?: number; cpuBw?: number }

function pools(hw: Hardware): Pool[] {
  if (hw.gpu.kind === 'unified') return [{ device: 'gpu', memGB: hw.totalRamGB * 0.7, bw: bandwidthGBs(hw, 'gpu') }]
  const cpu: Pool = { device: 'cpu', memGB: hw.totalRamGB * 0.5, bw: bandwidthGBs(hw, 'cpu') }
  if (hw.gpu.kind !== 'discrete') return [cpu]
  const gpu: Pool = { device: 'gpu', memGB: hw.gpu.vramGB * 0.95, bw: bandwidthGBs(hw, 'gpu') }
  // llama.cpp offloads as many layers as fit on the card and runs the rest from system memory
  const split: Pool = { device: 'split', memGB: gpu.memGB + cpu.memGB, bw: gpu.bw, gpuMemGB: gpu.memGB, cpuBw: cpu.bw }
  return [gpu, split, cpu]
}

function evaluate(hw: Hardware, model: CatalogModel, build: CatalogBuild): Choice | null {
  let best: Choice | null = null
  for (const pool of pools(hw)) {
    const kv = (c: number) => (KV_GB_PER_1K * c) / 1024
    const ctx = CONTEXTS.find((c) => c <= model.contextMax && build.sizeGB + kv(c) + OVERHEAD_GB <= pool.memGB)
    if (!ctx) continue
    const bytesPerToken = build.sizeGB * (build.activeParamsB / build.paramsB)
    // the share of the weights on the card; the cache and overhead live there too
    const onCard = pool.gpuMemGB === undefined ? 1 : Math.min(1, Math.max(0, pool.gpuMemGB - kv(ctx) - OVERHEAD_GB) / build.sizeGB)
    if (pool.device === 'split' && onCard >= 1) continue // fits on the card: that's the gpu pool
    const secPerToken = (bytesPerToken * onCard) / pool.bw + (pool.cpuBw ? (bytesPerToken * (1 - onCard)) / pool.cpuBw : 0)
    const estTokPerSec = Math.round((1 / secPerToken) * EFFICIENCY * 10) / 10
    const choice: Choice = {
      model, build, contextSize: ctx, estTokPerSec, device: pool.device,
      needsDiskGB: Math.max(0, Math.round((build.sizeGB + DISK_HEADROOM_GB - hw.freeDiskGB) * 100) / 100),
    }
    if (!best || choice.contextSize > best.contextSize || (choice.contextSize === best.contextSize && choice.estTokPerSec > best.estTokPerSec)) best = choice
  }
  return best
}

// Agent tasks need room: among equal agent scores, full context beats a squeezed one.
const rank = (a: Choice, b: Choice) =>
  b.model.agentScore - a.model.agentScore ||
  b.contextSize - a.contextSize ||
  b.model.chatScore - a.model.chatScore ||
  b.estTokPerSec - a.estTokPerSec

export function pick(hw: Hardware, models: CatalogModel[], opts: { minTokPerSec?: number } = {}): PickResult {
  const minTok = opts.minTokPerSec ?? MIN_TOK_PER_SEC
  const runs = models
    .map((m) => m.builds.map((b) => evaluate(hw, m, b)).filter((c): c is Choice => c !== null).sort(rank)[0])
    .filter((c): c is Choice => !!c)
  // a last-resort model or a squeezed build isn't offered where something better runs well
  const good = new Set(runs.filter((c) => c.estTokPerSec >= minTok && !c.model.lastResort).map((c) => c.model.id))
  const hidden = new Set(models.filter((m) => (m.lastResort && good.size > 0) || (m.squeezedOf && good.has(m.squeezedOf))).map((m) => m.id))
  const fitting = runs.filter((c) => !hidden.has(c.model.id))

  const all = fitting.filter((c) => c.estTokPerSec >= minTok).sort(rank)
  const recommended = all[0] ?? null

  const smarter = recommended
    ? fitting
        .filter((c) => c.estTokPerSec < minTok && c.estTokPerSec >= SMARTER_MIN_TOK_PER_SEC && c.model.agentScore > recommended.model.agentScore)
        .sort(rank)[0]
    : undefined

  const faster = recommended
    ? all.filter((c) => c !== recommended && c.estTokPerSec > recommended.estTokPerSec * 1.5).sort(rank)[0]
    : undefined

  const starter = fitting.filter((c) => c.model.starter).sort((a, b) => a.build.sizeGB - b.build.sizeGB)[0] ?? null

  const selectable = new Set([...all, ...(smarter ? [smarter] : [])].map((c) => c.model.id))
  const fittingIds = new Set(fitting.map((c) => c.model.id))
  const unavailable = models
    .filter((m) => !selectable.has(m.id) && !hidden.has(m.id))
    .map((m) => ({ model: m, reason: fittingIds.has(m.id) ? ('slow' as const) : ('memory' as const) }))

  return {
    recommended, all, starter, faster, smarter, unavailable,
    liteMode: !recommended || recommended.model.agentScore < LITE_AGENT_SCORE,
  }
}
