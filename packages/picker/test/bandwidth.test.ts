import { describe, expect, it } from 'vitest'
import { bandwidthGBs } from '../src/bandwidth'
import { machines } from './fixtures'

describe('bandwidthGBs', () => {
  it('knows Apple chips, longest match wins', () => {
    expect(bandwidthGBs(machines.m1_16, 'gpu')).toBe(68)
    expect(bandwidthGBs(machines.m1max32, 'gpu')).toBe(400)
    expect(bandwidthGBs(machines.m4max128, 'gpu')).toBe(546)
  })
  it('knows NVIDIA cards', () => {
    expect(bandwidthGBs(machines.linux3060, 'gpu')).toBe(360)
  })
  it('falls back for unknown discrete GPU and CPU', () => {
    expect(bandwidthGBs({ ...machines.linux3060, gpu: { kind: 'discrete', name: 'Mystery GPU', vramGB: 8 } }, 'gpu')).toBe(300)
    expect(bandwidthGBs(machines.cpu32, 'cpu')).toBe(50)
  })
})
