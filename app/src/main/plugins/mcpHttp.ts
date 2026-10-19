import type { HttpSpec, Incoming, Transport } from './mcp'
import { McpAuthError, McpSessionExpired, PROTOCOL } from './mcp'

/** Server-sent events from a response body (https://html.spec.whatwg.org/multipage/server-sent-events.html) */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: string }> {
  const decoder = new TextDecoder()
  let buf = ''
  let event = ''
  let data: string[] = []
  const reader = body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      buf += done ? '\n' : decoder.decode(value, { stream: true })
      // a trailing \r may be the first half of \r\n: wait for the next chunk
      const cut = !done && buf.endsWith('\r') ? buf.length - 1 : buf.length
      const lines = buf.slice(0, cut).split(/\r\n|\r|\n/)
      // the last piece may be a partial line
      buf = (lines.pop() ?? '') + buf.slice(cut)
      for (const line of lines) {
        if (line === '') {
          if (data.length) yield { event: event || 'message', data: data.join('\n') }
          event = ''; data = []
          continue
        }
        if (line.startsWith(':')) continue
        const i = line.indexOf(':')
        const field = i < 0 ? line : line.slice(0, i)
        const value = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '')
        if (field === 'event') event = value
        else if (field === 'data') data.push(value)
      }
      if (done) return
    }
  } finally {
    reader.releaseLock()
    await body.cancel().catch(() => {})
  }
}

const host = (u: string) => { try { return new URL(u).host } catch { return u } }
const errText = (e: unknown) => (e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e))

/**
 * A remote MCP server: Streamable HTTP (2025-03-26+), falling back to the older HTTP+SSE transport.
 * Auth: configured headers (API keys) and/or an OAuth token that is refreshed once when rejected.
 */
export class HttpTransport implements Transport {
  private session: string | undefined
  private version = PROTOCOL
  private initId: number | string | undefined
  private legacy: string | undefined
  private aborts = new Set<AbortController>()
  private onMessage: (m: Incoming) => void = () => {}
  private onGone: (why: string) => void = () => {}
  private closed = false

  constructor(private spec: HttpSpec) {}

  async open(onMessage: (m: Incoming) => void, onGone: (why: string) => void) {
    this.onMessage = onMessage
    this.onGone = onGone
    if (this.spec.transport === 'sse' || /\/sse\/?$/.test(new URL(this.spec.url).pathname)) await this.openLegacy()
  }

  private async headers(): Promise<Record<string, string>> {
    const h: Record<string, string> = { ...this.spec.headers }
    const token = await this.spec.auth?.token()
    if (token) {
      for (const k of Object.keys(h)) if (k.toLowerCase() === 'authorization') delete h[k]
      h.authorization = `Bearer ${token}`
    }
    return h
  }

  /** fetch with auth; a rejected token is refreshed once */
  private async fetch(url: string, init: RequestInit & { headers?: Record<string, string> }, retry = true): Promise<{ res: Response; done(): void }> {
    const ac = new AbortController()
    this.aborts.add(ac)
    const done = () => { this.aborts.delete(ac) }
    let res: Response
    try {
      res = await fetch(url, { ...init, headers: { ...(await this.headers()), ...init.headers }, signal: ac.signal })
    } catch (e) {
      done()
      throw new Error(`Couldn't reach ${host(url)}: ${errText(e)}`)
    }
    const www = res.headers.get('www-authenticate') ?? ''
    if (res.status === 401 || (res.status === 403 && /insufficient_scope/.test(www))) {
      await res.body?.cancel().catch(() => {})
      done()
      if (retry && this.spec.auth && (await this.spec.auth.refresh())) return this.fetch(url, init, false)
      throw new McpAuthError(www)
    }
    return { res, done }
  }

  private deliver(m: Incoming) {
    if (this.initId !== undefined && m.id === this.initId) {
      const v = (m.result as { protocolVersion?: unknown } | undefined)?.protocolVersion
      if (typeof v === 'string') this.version = v
    }
    this.onMessage(m)
  }

  async send(m: { id?: number | string; method?: string }): Promise<void> {
    const body = JSON.stringify(m)
    if (this.legacy) {
      const { res, done } = await this.fetch(this.legacy, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
      done()
      await res.body?.cancel().catch(() => {})
      if (!res.ok) throw new Error(`${host(this.spec.url)} answered with an error (${res.status}).`)
      return
    }
    const init = m.method === 'initialize'
    if (init) this.initId = m.id
    const { res, done } = await this.fetch(this.spec.url, {
      method: 'POST', body,
      headers: {
        'content-type': 'application/json', accept: 'application/json, text/event-stream',
        ...(this.session ? { 'mcp-session-id': this.session } : {}),
        ...(init ? {} : { 'mcp-protocol-version': this.version }),
      },
    })
    try {
      if (init && !this.session && [400, 404, 405].includes(res.status)) {
        // an older server: GET opens an event stream that names where to POST
        const said = (await res.text().catch(() => '')).slice(0, 300)
        try { await this.openLegacy() } catch (e) {
          if (e instanceof McpAuthError || /another site/.test(String(e))) throw e
          throw new Error(res.status === 400 && said ? `${host(this.spec.url)} answered with an error (400): ${said}` : `${host(this.spec.url)} doesn't look like an MCP server (it answered ${res.status}).`)
        }
        return this.send(m)
      }
      if (res.status === 404 && this.session) {
        this.session = undefined
        await res.body?.cancel().catch(() => {})
        throw new McpSessionExpired('The app connection session ended.')
      }
      if (!res.ok) {
        const text = (await res.text().catch(() => '')).slice(0, 300)
        throw new Error(`${host(this.spec.url)} answered with an error (${res.status})${text ? `: ${text}` : '.'}`)
      }
      const sid = res.headers.get('mcp-session-id')
      if (sid) this.session = sid
      if (res.status === 202 || !res.body) return
      const type = res.headers.get('content-type') ?? ''
      if (type.includes('text/event-stream')) {
        let answered = m.id === undefined
        for await (const e of parseSse(res.body)) {
          if (e.event !== 'message' || !e.data) continue
          let msg: Incoming
          try { msg = JSON.parse(e.data) } catch { continue }
          if (msg.id === m.id && !msg.method) answered = true
          this.deliver(msg)
          // the answer is in: stop reading, even if the server keeps the stream open
          if (answered && m.id !== undefined) break
        }
        if (!answered && !this.closed) throw new Error('The app connection closed before answering.')
        return
      }
      const text = await res.text()
      if (!text.trim()) return
      const parsed = JSON.parse(text) as Incoming | Incoming[]
      for (const msg of Array.isArray(parsed) ? parsed : [parsed]) this.deliver(msg)
    } finally {
      done()
    }
  }

  private async openLegacy() {
    const { res, done } = await this.fetch(this.spec.url, { method: 'GET', headers: { accept: 'text/event-stream' } })
    if (!res.ok || !res.body || !(res.headers.get('content-type') ?? '').includes('text/event-stream')) {
      done()
      await res.body?.cancel().catch(() => {})
      throw new Error(`${host(this.spec.url)} answered with an error (${res.status}).`)
    }
    const events = parseSse(res.body)
    for (;;) {
      const r = await events.next()
      if (r.done) { done(); throw new Error('The app connection closed before it was ready.') }
      if (r.value.event === 'endpoint') {
        const endpoint = new URL(r.value.data.trim(), this.spec.url)
        // requests carry the user's key or token: they only go to the server the user connected
        if (endpoint.origin !== new URL(this.spec.url).origin) { done(); await events.return(undefined); throw new Error(`${host(this.spec.url)} tried to send requests to another site. Hob won't connect to it.`) }
        this.legacy = endpoint.toString()
        break
      }
    }
    // replies arrive on this stream from now on
    void (async () => {
      for await (const e of events) {
        if (e.event !== 'message') continue
        try { this.deliver(JSON.parse(e.data)) } catch { /* not JSON */ }
      }
    })().then(
      () => { if (!this.closed) this.onGone('The app connection closed.') },
      (e) => { if (!this.closed) this.onGone(`The app connection stopped: ${errText(e)}`) },
    ).finally(done)
  }

  close() {
    this.closed = true
    // tell the server the session is over; nobody waits for the answer
    if (this.session && !this.legacy) {
      const session = this.session
      void this.headers().then((h) => fetch(this.spec.url, { method: 'DELETE', headers: { ...h, 'mcp-session-id': session, 'mcp-protocol-version': this.version } })).catch(() => {})
    }
    this.session = undefined
    for (const ac of this.aborts) ac.abort()
    this.aborts.clear()
  }
}
