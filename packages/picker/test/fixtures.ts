import type { CatalogModel, Hardware } from '../src/types'

const m = (id: string, agentScore: number, chatScore: number, sizeGB: number, paramsB: number, activeParamsB: number, starter = false): CatalogModel => ({
  id, name: id, family: id.startsWith('gpt-oss') ? 'gpt-oss' : id.split('-')[0], license: 'Apache-2.0', agentScore, chatScore,
  contextMax: 32768, minAppVersion: '0.1.0', addedAt: '2026-10-01', starter,
  builds: [{ quant: 'Q4_K_M', url: `https://example.com/${id}.gguf`, sha256: 'a'.repeat(64), sizeGB, paramsB, activeParamsB }],
})

export const models: CatalogModel[] = [
  { ...m('qwen3-1.7b', 2, 3, 1.83, 1.7, 1.7), lastResort: true },
  m('gemma-4-e2b', 5, 5, 3.35, 5.1, 2.3),
  m('gemma-4-e4b', 7, 7, 5.15, 8, 4, true),
  { ...m('gemma-4-e4b-compact', 6, 6, 3.86, 8, 4), squeezedOf: 'gemma-4-e4b' },
  m('gpt-oss-20b', 6, 7, 12.11, 21, 3.6),
  m('gemma-4-26b-a4b', 8, 8, 14.44, 26, 4),
  { ...m('gemma-4-26b-a4b-compact', 5, 6, 9.66, 26, 4), squeezedOf: 'gemma-4-26b-a4b' },
  m('gpt-oss-120b', 9, 9, 63.39, 117, 5.1),
]

const hw = (o: Partial<Hardware> & Pick<Hardware, 'gpu' | 'totalRamGB'>): Hardware => ({
  os: 'darwin', arch: 'arm64', cpuModel: 'Apple M1', freeDiskGB: 500, ...o,
})

export const machines = {
  winLaptop8: hw({ os: 'win32', arch: 'x64', cpuModel: 'Intel Core i5-1135G7', totalRamGB: 8, gpu: { kind: 'none', name: '', vramGB: 0 } }),
  linux3060: hw({ os: 'linux', arch: 'x64', cpuModel: 'AMD Ryzen 5 5600X', totalRamGB: 16, gpu: { kind: 'discrete', name: 'NVIDIA GeForce RTX 3060', vramGB: 12 } }),
  // an 8 GB Mac reports 8.6 GB, a 16 GB Mac about 17.2 GB (bytes / 1e9)
  mac8: hw({ cpuModel: 'Apple M1', totalRamGB: 8.6, gpu: { kind: 'unified', name: 'Apple M1', vramGB: 6 } }),
  // a 16 GB Mac reports about 17.2 GB (bytes / 1e9)
  m3air16: hw({ cpuModel: 'Apple M3', totalRamGB: 17.2, gpu: { kind: 'unified', name: 'Apple M3', vramGB: 12 } }),
  m1_16: hw({ cpuModel: 'Apple M1', totalRamGB: 16, gpu: { kind: 'unified', name: 'Apple M1', vramGB: 12 } }),
  m1max32: hw({ cpuModel: 'Apple M1 Max', totalRamGB: 32, gpu: { kind: 'unified', name: 'Apple M1 Max', vramGB: 24 } }),
  m4max128: hw({ cpuModel: 'Apple M4 Max', totalRamGB: 128, gpu: { kind: 'unified', name: 'Apple M4 Max', vramGB: 96 } }),
  cpu32: hw({ os: 'linux', arch: 'x64', cpuModel: 'Intel Core i7-12700', totalRamGB: 32, gpu: { kind: 'none', name: '', vramGB: 0 } }),
  rtx4060_16: hw({ os: 'win32', arch: 'x64', cpuModel: 'Intel Core i5-13400F', totalRamGB: 16, gpu: { kind: 'discrete', name: 'NVIDIA GeForce RTX 4060', vramGB: 8 } }),
  rtx3060_32: hw({ os: 'win32', arch: 'x64', cpuModel: 'AMD Ryzen 5 5600X', totalRamGB: 32, gpu: { kind: 'discrete', name: 'NVIDIA GeForce RTX 3060', vramGB: 12 } }),
  rtx4090_64: hw({ os: 'linux', arch: 'x64', cpuModel: 'AMD Ryzen 9 7950X', totalRamGB: 64, gpu: { kind: 'discrete', name: 'NVIDIA GeForce RTX 4090', vramGB: 24 } }),
  rtx5090_64: hw({ os: 'win32', arch: 'x64', cpuModel: 'AMD Ryzen 9 9950X', totalRamGB: 64, gpu: { kind: 'discrete', name: 'NVIDIA GeForce RTX 5090', vramGB: 32 } }),
  tiny4: hw({ os: 'win32', arch: 'x64', cpuModel: 'Intel Celeron', totalRamGB: 4, gpu: { kind: 'none', name: '', vramGB: 0 } }),
}
