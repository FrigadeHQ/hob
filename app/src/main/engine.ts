import { utilityProcess, type UtilityProcess } from 'electron'
import type { EngineEvent, EngineRequest, GpuProbe } from '../shared/engine-protocol'
import type { ChatMessage } from '../shared/types'
import type { ToolSpec } from '../shared/agent'

export type { GpuProbe }

export class InsufficientMemoryError extends Error { name = 'InsufficientMemoryError' }

/** maxTokens: cap on the answer (short jobs like naming a chat) */
/** thoughtBudgetWithTools: the budget once a tool has been called. side: the small second model, if loaded. reasoning: gpt-oss's own level */
export type ChatRequest = { messages: ChatMessage[]; tools?: ToolSpec[]; thoughtBudget?: number; thoughtBudgetWithTools?: number; maxTokens?: number; side?: boolean; reasoning?: 'low' | 'high' }
export type ChatHandlers = {
  onToken(t: string, thought?: boolean): void
  /** run a tool the model asked for; the string goes back to the model */
  onTool?(name: string, args: unknown): Promise<string>
}

export interface Engine {
  probe(): Promise<GpuProbe>
  load(modelPath: string, contextSize: number): Promise<void>
  chat(req: ChatRequest, h: ChatHandlers, signal?: AbortSignal): Promise<string>
  /** read a conversation ahead so its next message starts at once; a newer preload replaces one still waiting */
  preload(messages: ChatMessage[], tools: ToolSpec[], reasoning?: 'low' | 'high'): Promise<void>
  /** a small second model for side jobs (naming chats) */
  loadSide(modelPath: string, contextSize: number): Promise<void>
  unload(): Promise<void>
  /** Called when the engine process dies unexpectedly (not on dispose). */
  onExit(cb: () => void): void
  dispose(): void
}

/** load: checking the computer or loading a model, where a graphics driver can crash the engine */
type Pending = { resolve(v: unknown): void; reject(e: Error): void; h?: ChatHandlers; load?: boolean; model?: boolean }
type Req = EngineRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never

export class UtilityEngine implements Engine {
  private proc: UtilityProcess | undefined
  private nextId = 1
  private pending = new Map<number, Pending>()
  private exitListeners: (() => void)[] = []
  private disposed = false
  /**
   * Some graphics drivers (seen on Windows) crash the engine as it checks the card or loads a model. After a crash
   * like that, the engine starts without the graphics card: slower, but it works.
   */
  private cpuOnly = false
  /** a model loaded fine in this process, so a later crash isn't the graphics card failing to start */
  private loaded = false

  constructor(private workerPath: string) {}

  private ensure(): UtilityProcess {
    if (this.proc) return this.proc
    const proc = utilityProcess.fork(this.workerPath, [], { serviceName: 'Hob Engine', env: { ...process.env, ...(this.cpuOnly ? { HOB_ENGINE_GPU: 'off' } : {}) } })
    this.loaded = false
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
      if (e.type === 'result' && p.model) this.loaded = true
      if (e.type === 'result') p.resolve(e.data)
      else p.reject(e.code === 'OOM' ? new InsufficientMemoryError(e.message) : new Error(e.message))
    })
    proc.on('exit', (code: number) => {
      this.proc = undefined
      const starting = !this.loaded && [...this.pending.values()].some((p) => p.load)
      console.error(`engine stopped (code ${code})${starting && !this.cpuOnly ? '; starting it again without the graphics card' : ''}`)
      if (starting) this.cpuOnly = true
      for (const p of this.pending.values()) p.reject(new InsufficientMemoryError('Engine stopped unexpectedly'))
      this.pending.clear()
      if (!this.disposed) for (const cb of this.exitListeners) cb()
    })
    return (this.proc = proc)
  }

  private call<T>(req: Req, h?: ChatHandlers): { id: number; done: Promise<T> } {
    const id = this.nextId++
    const model = req.type === 'load' || req.type === 'loadSide'
    const done = new Promise<T>((resolve, reject) => this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, h, load: model || req.type === 'probe', model }))
    this.ensure().postMessage({ ...req, id })
    return { id, done }
  }

  probe() { return this.call<GpuProbe>({ type: 'probe' }).done }
  async load(modelPath: string, contextSize: number) { await this.call({ type: 'load', modelPath, contextSize }).done }
  async unload() { await this.call({ type: 'unload' }).done }

  async loadSide(modelPath: string, contextSize: number) { await this.call({ type: 'loadSide', modelPath, contextSize }).done }

  /** the preload waiting its turn: only the newest is worth reading (the user moved on) */
  private queued: { messages: ChatMessage[]; tools: ToolSpec[]; reasoning?: 'low' | 'high'; done: Promise<void> } | undefined
  /** requests sent and not answered yet; a preload goes out once the worker is free */
  private busy = 0
  preload(messages: ChatMessage[], tools: ToolSpec[], reasoning?: 'low' | 'high'): Promise<void> {
    if (this.queued) { Object.assign(this.queued, { messages, tools, reasoning }); return this.queued.done }
    const q: { messages: ChatMessage[]; tools: ToolSpec[]; reasoning?: 'low' | 'high'; done: Promise<void> } = { messages, tools, reasoning, done: Promise.resolve() }
    this.queued = q
    q.done = (async () => {
      // wait for chats in progress: the worker runs one thing at a time, and a stale preload would delay the next chat
      while (this.busy > 0) await new Promise((r) => setTimeout(r, 100))
      this.queued = undefined
      await this.call({ type: 'preload', messages: q.messages, tools: q.tools, ...(q.reasoning ? { reasoning: q.reasoning } : {}) }).done.catch(() => {})
    })()
    return q.done
  }

  chat(req: ChatRequest, h: ChatHandlers, signal?: AbortSignal) {
    const { id, done } = this.call<string>({ type: 'chat', messages: req.messages, tools: req.tools ?? [], thoughtBudget: req.thoughtBudget ?? 256, ...(req.thoughtBudgetWithTools ? { thoughtBudgetWithTools: req.thoughtBudgetWithTools } : {}), ...(req.maxTokens ? { maxTokens: req.maxTokens } : {}), ...(req.side ? { side: true } : {}), ...(req.reasoning ? { reasoning: req.reasoning } : {}) }, h)
    this.busy++
    void done.catch(() => {}).finally(() => { this.busy-- })
    signal?.addEventListener('abort', () => { this.call({ type: 'abort', targetId: id }).done.catch(() => {}) }, { once: true })
    return done
  }

  onExit(cb: () => void) { this.exitListeners.push(cb) }

  dispose() { this.disposed = true; this.proc?.kill() }
}
