import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Proc = EventEmitter & { env?: Record<string, string | undefined>; sent: { id: number; type: string }[]; postMessage(m: { id: number; type: string }): void; kill(): void }
const forks: Proc[] = []

vi.mock('electron', () => ({
  utilityProcess: {
    fork: (_path: string, _args: string[], opts: { env?: Record<string, string | undefined> }) => {
      const p = new EventEmitter() as Proc
      p.env = opts.env
      p.sent = []
      p.postMessage = (m) => { p.sent.push(m) }
      p.kill = () => {}
      forks.push(p)
      return p
    },
  },
}))

const { UtilityEngine, InsufficientMemoryError } = await import('../src/main/engine')

const answer = (p: Proc, type: string) => { const m = p.sent.find((s) => s.type === type)!; p.emit('message', { id: m.id, type: 'result', data: null }) }

describe('the engine process crashing', () => {
  beforeEach(() => { forks.length = 0 })

  it('a crash while loading a model starts the engine again without the graphics card', async () => {
    const e = new UtilityEngine('engine.js')
    const load = e.load('/m.gguf', 4096)
    expect(forks[0].env?.HOB_ENGINE_GPU).toBeUndefined()
    forks[0].emit('exit', 3221225477)
    await expect(load).rejects.toBeInstanceOf(InsufficientMemoryError)
    const again = e.load('/m.gguf', 4096)
    expect(forks[1].env?.HOB_ENGINE_GPU).toBe('off')
    answer(forks[1], 'load')
    await again
  })

  it('a crash while checking the computer does the same', async () => {
    const e = new UtilityEngine('engine.js')
    const probe = e.probe()
    forks[0].emit('exit', 1)
    await expect(probe).rejects.toThrow()
    void e.probe()
    expect(forks[1].env?.HOB_ENGINE_GPU).toBe('off')
  })

  it('a crash after a model loaded keeps the graphics card', async () => {
    const e = new UtilityEngine('engine.js')
    const load = e.load('/m.gguf', 4096)
    answer(forks[0], 'load')
    await load
    const chat = e.chat({ messages: [{ role: 'user', content: 'hi' }] }, { onToken() {} })
    forks[0].emit('exit', 1)
    await expect(chat).rejects.toThrow()
    void e.load('/m.gguf', 4096)
    expect(forks[1].env?.HOB_ENGINE_GPU).toBeUndefined()
  })
})
