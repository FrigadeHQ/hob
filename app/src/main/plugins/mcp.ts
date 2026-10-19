import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { HttpTransport } from './mcpHttp'

/** What an MCP server says about one of its tools (https://modelcontextprotocol.io). */
export type McpTool = {
  name: string
  title?: string
  description?: string
  inputSchema?: Record<string, unknown>
  annotations?: { title?: string; readOnlyHint?: boolean; destructiveHint?: boolean }
}
export type McpContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'resource'; resource: { uri: string; text?: string } }
  | { type: string; [k: string]: unknown }
export type McpCallResult = { content: McpContent[]; isError?: boolean }

/** a program on this computer, spoken to over stdin/stdout */
export type StdioSpec = { command: string; args?: string[]; env?: Record<string, string>; cwd?: string }
/** a token for a remote server; refresh() gets a new one after the server rejected it (false: sign in again) */
export type McpAuth = { token(): Promise<string | undefined>; refresh(): Promise<boolean> }
/** a server on the internet, at a URL */
export type HttpSpec = { url: string; headers?: Record<string, string>; transport?: 'http' | 'sse'; auth?: McpAuth }
export type McpServerSpec = StdioSpec | HttpSpec

/** the server wants the user to sign in (or the sign-in expired) */
export class McpAuthError extends Error {
  constructor(public wwwAuthenticate: string) { super('Sign in to use this app connection.') }
}
/** the server forgot our session: start a new one */
export class McpSessionExpired extends Error {}

export type Incoming = { jsonrpc?: string; id?: number | string; method?: string; result?: unknown; error?: { message?: string } }
/** how messages reach a server; one per connection */
export interface Transport {
  open(onMessage: (m: Incoming) => void, onGone: (why: string) => void): Promise<void>
  send(m: object): Promise<void>
  close(): void
}

export const PROTOCOL = '2025-06-18'
const START_MS = 90_000 // first `npx -y …` downloads the server
const CALL_MS = 120_000

class StdioTransport implements Transport {
  private child: ReturnType<typeof spawn> | undefined
  private stderr = ''
  constructor(private spec: StdioSpec) {}
  async open(onMessage: (m: Incoming) => void, onGone: (why: string) => void) {
    const child = spawn(this.spec.command, this.spec.args ?? [], { env: { ...process.env, ...this.spec.env }, cwd: this.spec.cwd, stdio: 'pipe' })
    this.child = child
    child.stderr!.on('data', (b: Buffer) => { this.stderr = (this.stderr + b.toString()).slice(-2000) })
    child.stdin!.on('error', () => {})
    createInterface({ input: child.stdout! }).on('line', (line) => {
      try { onMessage(JSON.parse(line)) } catch { /* servers sometimes log to stdout */ }
    })
    child.on('error', (e) => onGone(`Couldn't start ${this.spec.command}: ${e.message}`))
    child.on('exit', (code) => onGone(`The app connection stopped (exit code ${code}).${this.stderr ? `\n${this.stderr.trim().slice(-500)}` : ''}`))
  }
  async send(m: object) { this.child?.stdin!.write(JSON.stringify(m) + '\n') }
  close() { this.child?.stdin!.end(); this.child?.kill() }
  kill() { this.child?.kill() }
}

type Pending = { resolve(v: unknown): void; reject(e: Error): void; timer: NodeJS.Timeout }

/** An MCP server (a local program or a URL): connected on first use, reconnected after it goes away. */
export class McpClient {
  private t: Transport | undefined
  private ready: Promise<void> | undefined
  private pending = new Map<number, Pending>()
  private nextId = 1

  constructor(private spec: McpServerSpec) {}

  private failAll(err: Error) {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(err) }
    this.pending.clear()
  }
  private drop(t: Transport) {
    t.close()
    if (this.t !== t) return
    this.t = undefined
    this.ready = undefined
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready
    const t: Transport = 'url' in this.spec ? new HttpTransport(this.spec) : new StdioTransport(this.spec)
    this.t = t
    this.ready = (async () => {
      const gone = (why: string) => {
        if (this.t !== t) return
        this.t = undefined
        this.ready = undefined
        this.failAll(new Error(why))
      }
      try {
        await t.open((m) => this.onMessage(m), gone)
        await this.request('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'Hob', version: '0.1.0' } }, START_MS)
        this.notify('notifications/initialized')
      } catch (e) {
        // a server that never finished starting must not keep running (each retry would start another)
        this.drop(t)
        throw e
      }
    })()
    // a failed start is retried on the next use
    this.ready.catch(() => {})
    return this.ready
  }

  private onMessage(m: Incoming) {
    if (m.method && m.id !== undefined) {
      // requests from the server (ping, roots, sampling): answer ping, decline the rest
      this.write(m.method === 'ping' ? { jsonrpc: '2.0', id: m.id, result: {} } : { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Not supported by Hob' } })
      return
    }
    const p = typeof m.id === 'number' ? this.pending.get(m.id) : undefined
    if (!p) return
    this.pending.delete(m.id as number)
    clearTimeout(p.timer)
    if (m.error) p.reject(new Error(m.error.message ?? 'The app connection returned an error'))
    else p.resolve(m.result)
  }

  private write(m: unknown) { void this.t?.send(m as object).catch(() => {}) }
  private notify(method: string, params?: unknown) { this.write({ jsonrpc: '2.0', method, ...(params ? { params } : {}) }) }
  private request<T>(method: string, params: unknown, timeoutMs: number, signal?: AbortSignal): Promise<T> {
    const id = this.nextId++
    const t = this.t
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('The app connection took too long to answer.')) }, timeoutMs)
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
      signal?.addEventListener('abort', () => {
        if (!this.pending.delete(id)) return
        clearTimeout(timer)
        this.notify('notifications/cancelled', { requestId: id, reason: 'Stopped by the user' })
        reject(new Error('Stopped by the user.'))
      }, { once: true })
      if (!t) { this.pending.delete(id); clearTimeout(timer); reject(new Error('The app connection is not running.')); return }
      t.send({ jsonrpc: '2.0', id, method, params }).catch((e: Error) => {
        // an expired session means a new one on the next use; calls still waiting on it start again too
        if (e instanceof McpSessionExpired) {
          this.pending.delete(id)
          this.failAll(e)
          this.drop(t)
          clearTimeout(timer)
          reject(e)
          return
        }
        const p = this.pending.get(id)
        if (!p) return
        this.pending.delete(id)
        clearTimeout(p.timer)
        p.reject(e)
      })
    })
  }

  /** waiting for the server to start still ends when the user presses Stop */
  private started(signal?: AbortSignal): Promise<void> {
    if (!signal) return this.start()
    if (signal.aborted) return Promise.reject(new Error('Stopped by the user.'))
    return new Promise((resolve, reject) => {
      const stop = () => reject(new Error('Stopped by the user.'))
      signal.addEventListener('abort', stop, { once: true })
      this.start().then(resolve, reject).finally(() => signal.removeEventListener('abort', stop))
    })
  }

  /** run once more on a fresh session if the server forgot the old one */
  private async retrying<T>(f: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.started(signal)
    try { return await f() } catch (e) {
      if (!(e instanceof McpSessionExpired) || signal?.aborted) throw e
      await this.started(signal)
      return f()
    }
  }

  async listTools(signal?: AbortSignal): Promise<McpTool[]> {
    return this.retrying(async () => {
      const tools: McpTool[] = []
      let cursor: string | undefined
      for (let page = 0; page < 20; page++) {
        const r = await this.request<{ tools: McpTool[]; nextCursor?: string }>('tools/list', cursor ? { cursor } : {}, CALL_MS, signal)
        tools.push(...(r.tools ?? []))
        cursor = r.nextCursor
        if (!cursor) break
      }
      return tools
    }, signal)
  }

  async call(name: string, args: unknown, signal: AbortSignal): Promise<McpCallResult> {
    return this.retrying(() => this.request<McpCallResult>('tools/call', { name, arguments: args ?? {} }, CALL_MS, signal), signal)
  }

  /** stop a local server process (it restarts on next use) */
  kill() { if (this.t instanceof StdioTransport) this.t.kill() }
  close() {
    const t = this.t
    this.t = undefined
    this.ready = undefined
    this.failAll(new Error('The app connection was turned off.'))
    t?.close()
  }
}
