import { describe, expect, it } from 'vitest'
import { serial } from '../src/engine/serial'

describe('serial (I2/I6: engine requests run one at a time)', () => {
  it('runs tasks strictly in order, never overlapping', async () => {
    const run = serial()
    const log: string[] = []
    const task = (name: string, ms: number) => run(async () => { log.push(`start ${name}`); await new Promise((r) => setTimeout(r, ms)); log.push(`end ${name}`) })
    await Promise.all([task('chat', 30), task('load', 5), task('chat2', 1)])
    expect(log).toEqual(['start chat', 'end chat', 'start load', 'end load', 'start chat2', 'end chat2'])
  })
  it('a failing task does not block the queue', async () => {
    const run = serial()
    await expect(run(async () => { throw new Error('x') })).rejects.toThrow('x')
    await expect(run(async () => 42)).resolves.toBe(42)
  })
})
