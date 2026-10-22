export type OS = 'darwin' | 'win32' | 'linux'

export interface Hardware {
  os: OS
  arch: string
  cpuModel: string
  totalRamGB: number
  freeDiskGB: number
  gpu: { kind: 'unified' | 'discrete' | 'none'; name: string; vramGB: number }
}

export interface CatalogBuild {
  quant: string
  url: string
  sha256: string
  sizeGB: number
  paramsB: number
  activeParamsB: number
}

export interface CatalogModel {
  id: string
  name: string
  family: string
  license: string
  agentScore: number
  chatScore: number
  contextMax: number
  minAppVersion: string
  addedAt: string
  starter: boolean
  /** offered only when no other model runs well here (a tiny model for weak computers) */
  lastResort?: boolean
  /** a squeezed build of this other model: offered only where that one doesn't run well */
  squeezedOf?: string
  /** one-line trade-off shown in the model list, e.g. "Very fast, less capable" */
  description?: string
  builds: CatalogBuild[]
}

export interface Catalog {
  version: 1
  models: CatalogModel[]
}

export interface Choice {
  model: CatalogModel
  build: CatalogBuild
  contextSize: number
  estTokPerSec: number
  /** split: what fits on the graphics card runs there, the rest from system memory */
  device: 'gpu' | 'cpu' | 'split'
  /** 0 when there is enough free disk; otherwise GB the user must free */
  needsDiskGB: number
}

export interface PickResult {
  recommended: Choice | null
  faster?: Choice
  smarter?: Choice
  /** fast-enough choices, ranked best first */
  all: Choice[]
  /** catalog models this computer can't run well: too big ('memory') or too slow ('slow') */
  unavailable: { model: CatalogModel; reason: 'memory' | 'slow' }[]
  starter: Choice | null
  liteMode: boolean
}
