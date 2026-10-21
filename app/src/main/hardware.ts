import os from 'node:os'
import type { Hardware, OS } from '@garth/picker'
import type { GpuProbe } from './engine'
import { realDeps } from './downloader'

export type SysInfo = { platform: string; arch: string; cpuModel: string; totalRamBytes: number; freeDiskGB: number }

export function toHardware(p: GpuProbe, sys: SysInfo): Hardware {
  const kind = !p.gpuType ? 'none' : p.gpuType === 'metal' || p.unifiedGB > 0 ? 'unified' : 'discrete'
  return {
    os: sys.platform as OS,
    arch: sys.arch,
    cpuModel: sys.cpuModel,
    totalRamGB: Math.round((sys.totalRamBytes / 1e9) * 10) / 10,
    freeDiskGB: Math.round(sys.freeDiskGB * 10) / 10,
    gpu: { kind, name: p.gpuNames[0] ?? (kind === 'unified' ? sys.cpuModel : ''), vramGB: Math.round(p.vramTotalGB * 10) / 10 },
  }
}

export async function readSysInfo(diskDir: string): Promise<SysInfo> {
  return {
    platform: process.platform, arch: process.arch,
    cpuModel: os.cpus()[0]?.model ?? 'unknown',
    totalRamBytes: os.totalmem(),
    freeDiskGB: await realDeps.freeDiskGB(diskDir),
  }
}
