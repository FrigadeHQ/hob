import { describe, expect, it } from 'vitest'
import { toHardware } from '../src/main/hardware'

const sys = { platform: 'darwin', arch: 'arm64', cpuModel: 'Apple M1 Max', totalRamBytes: 32e9, freeDiskGB: 200 }

describe('toHardware', () => {
  it('Apple Silicon → unified', () => {
    const hw = toHardware({ gpuType: 'metal', vramTotalGB: 24, unifiedGB: 24, gpuNames: ['Apple M1 Max'] }, sys)
    expect(hw.gpu).toEqual({ kind: 'unified', name: 'Apple M1 Max', vramGB: 24 })
    expect(hw.totalRamGB).toBe(32)
  })
  it('CUDA → discrete', () => {
    const hw = toHardware({ gpuType: 'cuda', vramTotalGB: 12, unifiedGB: 0, gpuNames: ['NVIDIA GeForce RTX 3060'] }, { ...sys, platform: 'linux', arch: 'x64', cpuModel: 'Ryzen' })
    expect(hw.gpu.kind).toBe('discrete')
    expect(hw.os).toBe('linux')
  })
  it('no GPU → none', () => {
    const hw = toHardware({ gpuType: false, vramTotalGB: 0, unifiedGB: 0, gpuNames: [] }, { ...sys, platform: 'win32' })
    expect(hw.gpu.kind).toBe('none')
  })
  it('Vulkan iGPU sharing memory → unified', () => {
    const hw = toHardware({ gpuType: 'vulkan', vramTotalGB: 16, unifiedGB: 16, gpuNames: ['AMD Radeon 780M'] }, { ...sys, platform: 'linux' })
    expect(hw.gpu.kind).toBe('unified')
  })
})
