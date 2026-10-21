import { utilityProcess, type UtilityProcess } from 'electron'
import type { EngineEvent, EngineRequest, GpuProbe } from '../shared/engine-protocol'
import type { ChatMessage } from '../shared/types'
import type { ToolSpec } from '../shared/agent'

export type { GpuProbe }

export class InsufficientMemoryError extends Error { name = 'InsufficientMemoryError' }

/** maxTokens: cap on the answer (short jobs like naming a chat) */
export type ChatRequest = { messages: ChatMessage[]; tools?: ToolSpec[]; thoughtBudget?: number; maxTokens?: number }
export type ChatHandlers = {
  onToken(t: string, thought?: boolean): void
  /** run a tool the model asked for; the string goes back to the model */
  onTool?(name: string, args: unknown): Promise<string>
}

export interface Engine {
  probe(): Promise<GpuProbe>
  load(modelPath: string, contextSize: number): Promise<void>
  chat(req: ChatRequest, h: ChatHandlers, signal?: AbortSignal): Promise<string>
  unload(): Promise<void>
  /** Called when the engine process dies unexpectedly (not on dispose). */
  onExit(cb: () => void): void
  dispose(): void
}

type Pending = { resolve(v: unknown): void; reject(e: Error): void; h?: ChatHandlers }
type Req = EngineRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never

export class UtilityEngine implements Engine {
  private proc: UtilityProcess | undefined
  private nextId = 1
  private pending = new Map<number, Pending>()
  private exitListeners: (() => void)[] = []
  private disposed = false

  constructor(private workerPath: string) {}

  private ensure(): UtilityProcess {
    if (this.proc) return this.proc
    const proc = utilityProcess.fork(this.workerPath, [], { serviceName: 'Mabel Engine' })
    proc.on('message', (e: EngineEvent) => {
      const p = this.pending.get(e.id)
      if (!p) return
      if (e.type === 'token') return p.h?.onToken(e.text, e.thought)
      if (e.type === 'tool-call') {
        const run = p.h?.onTool ? p.h.onTool(e.name, e.args) : Promise.resolve('Tools are not available.')
        void run
          .catch((err: Error) => `The tool failed: ${err.message}`)
          .then((result) => this.proc?.postMessage({ id: 0, type: 'tool-result', callId: e.callId, result }))
        return
      }
      this.pending.delete(e.id)
      if (e.type === 'result') p.resolve(e.data)
      else p.reject(e.code === 'OOM' ? new InsufficientMemoryError(e.message) : new Error(e.message))
    })
    proc.on('exit', () => {
      this.proc = undefined
      for (const p of this.pending.values()) p.reject(new InsufficientMemoryError('Engine stopped unexpectedly'))
      this.pending.clear()
      if (!this.disposed) for (const cb of this.exitListeners) cb()
    })
    return (this.proc = proc)
  }

  private call<T>(req: Req, h?: ChatHandlers): { id: number; done: Promise<T> } {
    const id = this.nextId++
    const done = new Promise<T>((resolve, reject) => this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, h }))
    this.ensure().postMessage({ ...req, id })
    return { id, done }
  }

  probe() { return this.call<GpuProbe>({ type: 'probe' }).done }
  async load(modelPath: string, contextSize: number) { await this.call({ type: 'load', modelPath, contextSize }).done }
  async unload() { await this.call({ type: 'unload' }).done }

  chat(req: ChatRequest, h: ChatHandlers, signal?: AbortSignal) {
    const { id, done } = this.call<string>({ type: 'chat', messages: req.messages, tools: req.tools ?? [], thoughtBudget: req.thoughtBudget ?? 256, ...(req.maxTokens ? { maxTokens: req.maxTokens } : {}) }, h)
    signal?.addEventListener('abort', () => { this.call({ type: 'abort', targetId: id }).done.catch(() => {}) }, { once: true })
    return done
  }

  onExit(cb: () => void) { this.exitListeners.push(cb) }

  dispose() { this.disposed = true; this.proc?.kill() }
}
