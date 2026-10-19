import type { Hardware } from './types'

/** Memory bandwidth in GB/s. Longest matching key wins. */
const TABLE: Record<string, number> = {
  'Apple M1': 68, 'Apple M1 Pro': 200, 'Apple M1 Max': 400, 'Apple M1 Ultra': 800,
  'Apple M2': 100, 'Apple M2 Pro': 200, 'Apple M2 Max': 400, 'Apple M2 Ultra': 800,
  'Apple M3': 100, 'Apple M3 Pro': 150, 'Apple M3 Max': 400, 'Apple M3 Ultra': 819,
  'Apple M4': 120, 'Apple M4 Pro': 273, 'Apple M4 Max': 546,
  'Apple M5': 153,
  'RTX 3060': 360, 'RTX 3070': 448, 'RTX 3080': 760, 'RTX 3090': 936,
  'RTX 4060': 272, 'RTX 4070': 504, 'RTX 4080': 717, 'RTX 4090': 1008,
  'RTX 5060': 448, 'RTX 5070': 672, 'RTX 5080': 960, 'RTX 5090': 1792,
  'RX 7600': 288, 'RX 7800': 624, 'RX 7900': 960,
}
const KEYS = Object.keys(TABLE).sort((a, b) => b.length - a.length)

const lookup = (name: string) => KEYS.find((k) => name.includes(k))

export function bandwidthGBs(hw: Hardware, device: 'gpu' | 'cpu'): number {
  if (hw.gpu.kind === 'unified') {
    const k = lookup(hw.gpu.name) ?? lookup(hw.cpuModel)
    return k ? TABLE[k] : 100
  }
  if (device === 'gpu' && hw.gpu.kind === 'discrete') {
    const k = lookup(hw.gpu.name)
    return k ? TABLE[k] : 300
  }
  return 50
}
