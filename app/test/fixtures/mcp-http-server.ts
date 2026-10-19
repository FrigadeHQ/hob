// Remote MCP server for tests: Streamable HTTP (JSON or SSE replies), legacy HTTP+SSE, and OAuth 2.1 sign-in.
import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export type FixtureOpts = {
  /** requests need a bearer token from the OAuth flow */
  auth?: boolean
  /** answer requests as an SSE stream instead of plain JSON */
  sse?: boolean
  /** only the old HTTP+SSE transport (POST /mcp → 405) */
  legacy?: boolean
  /** no dynamic client registration */
  noRegistration?: boolean
  /** tokens the server accepts as API keys (Authorization: Bearer <key>) */
  apiKeys?: string[]
  /** what the protected resource metadata claims to be (a lying server names another service) */
  prmResource?: string
  /** keep answering SSE streams open after the reply */
  holdOpen?: boolean
}

const TOOLS = [
  { name: 'echo', description: 'Echo text back', inputSchema: { type: 'object', properties: { text: { type: 'string' } } }, annotations: { readOnlyHint: true } },
]

export async function startHttpFixture(o: FixtureOpts = {}) {
  const state = {
    tokens: new Set<string>(o.apiKeys ?? []),
    sessions: new Set<string>(),
    registered: [] as { client_id: string; redirect_uris: string[] }[],
    authorizeParams: undefined as URLSearchParams | undefined,
    tokenRequests: [] as URLSearchParams[],
    seenHeaders: [] as Record<string, string | string[] | undefined>[],
    deleted: 0,
    codes: new Map<string, { challenge: string; redirect: string }>(),
    n: 0,
  }
  let origin = ''
  const legacyStreams = new Map<string, ServerResponse>()

  const body = (req: IncomingMessage) => new Promise<string>((r) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => r(s)) })
  const json = (res: ServerResponse, status: number, v: unknown, headers: Record<string, string> = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(v)) }
  const answer = (m: { id?: number; method: string; params?: { name?: string; arguments?: { text?: string } } }) => {
    if (m.method === 'initialize') return { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'http-fixture', version: '1' } }
    if (m.method === 'tools/list') return { tools: TOOLS }
    if (m.method === 'tools/call') return { content: [{ type: 'text', text: `echo: ${m.params?.arguments?.text}` }] }
    return undefined
  }
  const authorized = (req: IncomingMessage) => !o.auth || state.tokens.has(String(req.headers.authorization ?? '').replace(/^Bearer /, ''))

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', origin)
    // OAuth: protected resource + authorization server metadata, registration, authorize, token
    if (url.pathname === '/.well-known/oauth-protected-resource/mcp') return json(res, 200, { resource: o.prmResource ?? `${origin}/mcp`, authorization_servers: [origin], scopes_supported: ['read'] })
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      return json(res, 200, { issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`, ...(o.noRegistration ? {} : { registration_endpoint: `${origin}/register` }), code_challenge_methods_supported: ['S256'] })
    }
    if (url.pathname === '/register' && req.method === 'POST') {
      const r = JSON.parse(await body(req)) as { redirect_uris: string[] }
      const c = { client_id: `client-${state.registered.length + 1}`, redirect_uris: r.redirect_uris }
      state.registered.push(c)
      return json(res, 201, c)
    }
    if (url.pathname === '/authorize') {
      state.authorizeParams = url.searchParams
      const code = `code-${++state.n}`
      state.codes.set(code, { challenge: url.searchParams.get('code_challenge') ?? '', redirect: url.searchParams.get('redirect_uri') ?? '' })
      const back = new URL(url.searchParams.get('redirect_uri')!)
      back.searchParams.set('code', code)
      back.searchParams.set('state', url.searchParams.get('state') ?? '')
      res.writeHead(302, { location: back.toString() }); return res.end()
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      const p = new URLSearchParams(await body(req))
      state.tokenRequests.push(p)
      if (p.get('grant_type') === 'authorization_code') {
        const c = state.codes.get(p.get('code') ?? '')
        const ok = c && c.redirect === p.get('redirect_uri') && createHash('sha256').update(p.get('code_verifier') ?? '').digest('base64url') === c.challenge
        if (!ok) return json(res, 400, { error: 'invalid_grant' })
      } else if (p.get('grant_type') === 'refresh_token') {
        if (p.get('refresh_token') !== 'refresh-1') return json(res, 400, { error: 'invalid_grant' })
      } else return json(res, 400, { error: 'unsupported_grant_type' })
      const access = `access-${++state.n}`
      state.tokens.add(access)
      return json(res, 200, { access_token: access, token_type: 'Bearer', expires_in: 3600, refresh_token: 'refresh-1' })
    }

    // legacy HTTP+SSE: GET /sse opens the stream and names the endpoint for POSTs
    if (o.legacy) {
      if (url.pathname === '/mcp' && req.method === 'POST') { res.writeHead(405); return res.end() }
      if (url.pathname === '/sse' || (url.pathname === '/mcp' && req.method === 'GET')) {
        const sid = `l${++state.n}`
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write(`event: endpoint\ndata: /messages?sid=${sid}\n\n`)
        legacyStreams.set(sid, res)
        return
      }
      if (url.pathname === '/messages' && req.method === 'POST') {
        const stream = legacyStreams.get(url.searchParams.get('sid') ?? '')
        const m = JSON.parse(await body(req))
        res.writeHead(202); res.end()
        const result = answer(m)
        if (m.id !== undefined && result) stream?.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: m.id, result })}\n\n`)
        return
      }
    }

    if (url.pathname === '/mcp') {
      state.seenHeaders.push(req.headers)
      if (!authorized(req)) {
        res.writeHead(401, { 'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="read"` })
        return res.end()
      }
      if (req.method === 'DELETE') { state.deleted++; state.sessions.delete(String(req.headers['mcp-session-id'])); res.writeHead(200); return res.end() }
      if (req.method === 'GET') { res.writeHead(405); return res.end() }
      const m = JSON.parse(await body(req))
      if (m.method !== 'initialize' && !state.sessions.has(String(req.headers['mcp-session-id']))) return json(res, 404, { jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' } })
      if (m.id === undefined) { res.writeHead(202); return res.end() }
      const headers: Record<string, string> = {}
      if (m.method === 'initialize') { const sid = `s${++state.n}`; state.sessions.add(sid); headers['mcp-session-id'] = sid }
      const reply = { jsonrpc: '2.0', id: m.id, result: answer(m) }
      if (o.sse) {
        res.writeHead(200, { 'content-type': 'text/event-stream', ...headers })
        // a server notification first, then the reply split over two data lines
        res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info', data: 'hi' } })}\n\n`)
        const text = JSON.stringify(reply)
        res.write(`id: 1\ndata: ${text.slice(0, 10)}\ndata: ${text.slice(10)}\n\n`)
        if (o.holdOpen) return
        return res.end()
      }
      return json(res, 200, reply, headers)
    }
    res.writeHead(404); res.end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    url: `${origin}/mcp`, origin, state,
    close: () => new Promise<void>((r) => { for (const s of legacyStreams.values()) s.end(); server.closeAllConnections(); server.close(() => r()) }),
  }
}
