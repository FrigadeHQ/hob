import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { t } from '../../shared/i18n'

/**
 * Signing in to a remote MCP server, as the MCP spec asks (OAuth 2.1 + PKCE):
 * find the server's auth server, register Hob as a client, open the browser, catch the redirect on 127.0.0.1.
 */
export type OAuthClient = { client_id: string; client_secret?: string; redirect_uri: string }
export type OAuthTokens = { access_token: string; refresh_token?: string; expires_at?: number }
export type OAuthState = {
  authorization_endpoint: string
  token_endpoint: string
  resource: string
  scope?: string
  client: OAuthClient
  tokens?: OAuthTokens
}
type AsMeta = { authorization_endpoint: string; token_endpoint: string; registration_endpoint?: string }

/** the port Hob listens on for the browser to come back; registered with each server, so it's stable when free */
export const CALLBACK_PORT = 33418
const SIGN_IN_MS = 5 * 60_000
const TIMEOUT_MS = 20_000

const b64url = (b: Buffer) => b.toString('base64url')
const param = (www: string | undefined, name: string) => www?.match(new RegExp(`${name}="([^"]*)"`))?.[1]

async function getJson<T>(url: string): Promise<T | undefined> {
  try {
    const r = await fetch(url, { headers: { accept: 'application/json', 'mcp-protocol-version': '2025-06-18' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!r.ok) { await r.body?.cancel(); return undefined }
    return (await r.json()) as T
  } catch { return undefined }
}

/** resource "https://a.com/mcp" covers "https://a.com/mcp" and "https://a.com/mcp/x", not other sites */
function covers(resource: string, serverUrl: string): boolean {
  try {
    const r = new URL(resource); const s = new URL(serverUrl)
    const rp = r.pathname.replace(/\/$/, '')
    return r.origin === s.origin && (rp === '' || s.pathname === rp || s.pathname.startsWith(`${rp}/`) || s.pathname.replace(/\/$/, '') === rp)
  } catch { return false }
}

/** the auth server for an MCP server (RFC 9728 protected resource metadata, then RFC 8414 / OpenID discovery) */
export async function discover(serverUrl: string, wwwAuthenticate?: string): Promise<{ meta: AsMeta; resource: string; scope?: string }> {
  const u = new URL(serverUrl)
  const path = u.pathname.replace(/\/$/, '')
  // metadata must come from the server itself
  const hinted = param(wwwAuthenticate, 'resource_metadata')
  const sameOrigin = (x: string) => { try { return new URL(x).origin === u.origin } catch { return false } }
  const prmUrls = [hinted && sameOrigin(hinted) ? hinted : undefined, `${u.origin}/.well-known/oauth-protected-resource${path}`, `${u.origin}/.well-known/oauth-protected-resource`].filter((x): x is string => !!x)
  let prm: { resource?: string; authorization_servers?: string[]; scopes_supported?: string[] } | undefined
  for (const url of [...new Set(prmUrls)]) if ((prm = await getJson(url))?.authorization_servers?.length) break
  // RFC 9728 §3.3: the metadata must describe this server. Otherwise a server could have the user sign in to
  // another service and receive that service's token.
  if (prm?.resource && !covers(prm.resource, serverUrl)) throw new Error(t("This app's sign-in details don't match its link ({host}). Hob won't sign in to it.", { host: u.host }))
  const issuer = prm?.authorization_servers?.[0] ?? u.origin
  const iu = new URL(issuer)
  const ip = iu.pathname.replace(/\/$/, '')
  const asUrls = ip
    ? [`${iu.origin}/.well-known/oauth-authorization-server${ip}`, `${iu.origin}/.well-known/openid-configuration${ip}`, `${iu.origin}${ip}/.well-known/openid-configuration`]
    : [`${iu.origin}/.well-known/oauth-authorization-server`, `${iu.origin}/.well-known/openid-configuration`]
  let meta: AsMeta | undefined
  for (const url of asUrls) if ((meta = await getJson<AsMeta>(url))?.authorization_endpoint && meta.token_endpoint) break
  // servers from before auth discovery: the endpoints sit at fixed paths
  if (!meta?.authorization_endpoint) meta = { authorization_endpoint: `${iu.origin}/authorize`, token_endpoint: `${iu.origin}/token`, registration_endpoint: `${iu.origin}/register` }
  const scope = param(wwwAuthenticate, 'scope') ?? prm?.scopes_supported?.join(' ')
  return { meta, resource: prm?.resource ?? serverUrl, ...(scope ? { scope } : {}) }
}

const listen = (server: Server, port: number) => new Promise<number>((resolve, reject) => {
  server.once('error', reject)
  server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve((server.address() as AddressInfo).port) })
})

async function register(meta: AsMeta, redirect: string): Promise<OAuthClient> {
  if (!meta.registration_endpoint) throw new Error(t("This app doesn't let Hob sign in by itself. Check its website for an API key, then add it as a header when you connect."))
  const r = await fetch(meta.registration_endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ client_name: 'Hob', redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((e: Error) => { throw new Error(t("Couldn't reach the sign-in server: {error}", { error: e.message })) })
  if (!r.ok) throw new Error(`${t("The sign-in server didn't accept Hob ({status}).", { status: String(r.status) })} ${(await r.text().catch(() => '')).slice(0, 200)}`.trim())
  const c = (await r.json()) as { client_id: string; client_secret?: string }
  return { client_id: c.client_id, ...(c.client_secret ? { client_secret: c.client_secret } : {}), redirect_uri: redirect }
}

async function token(s: Pick<OAuthState, 'token_endpoint' | 'resource' | 'client'>, form: Record<string, string>): Promise<OAuthTokens> {
  const body = new URLSearchParams({ ...form, client_id: s.client.client_id, resource: s.resource, ...(s.client.client_secret ? { client_secret: s.client.client_secret } : {}) })
  const r = await fetch(s.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body, signal: AbortSignal.timeout(TIMEOUT_MS) })
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string }
  if (!r.ok || !j.access_token) throw new Error(j.error_description ?? j.error ?? t('Sign-in failed ({status}).', { status: String(r.status) }))
  return { access_token: j.access_token, ...(j.refresh_token ? { refresh_token: j.refresh_token } : {}), ...(j.expires_in ? { expires_at: Date.now() + j.expires_in * 1000 } : {}) }
}

/** a token that's good for at least another minute */
export const tokenFresh = (s: OAuthState | undefined) => !!s?.tokens && (!s.tokens.expires_at || s.tokens.expires_at > Date.now() + 60_000)

/** new tokens from the refresh token; undefined when the user has to sign in again */
export async function refreshTokens(s: OAuthState): Promise<OAuthState | undefined> {
  if (!s.tokens?.refresh_token) return undefined
  try {
    const t = await token(s, { grant_type: 'refresh_token', refresh_token: s.tokens.refresh_token })
    return { ...s, tokens: { ...t, refresh_token: t.refresh_token ?? s.tokens.refresh_token } }
  } catch { return undefined }
}

const PAGE = (title: string, text: string) => `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font:16px -apple-system,system-ui,sans-serif;display:grid;place-items:center;height:90vh;margin:0;color:#222">
<div style="text-align:center"><h1 style="font-size:22px;font-weight:600">${title}</h1><p style="color:#666">${text}</p></div>`

export type SignInOpts = {
  serverUrl: string
  wwwAuthenticate?: string
  /** what an earlier sign-in saved: its registered client is reused */
  saved?: OAuthState
  /** a client the app's maker gave out, instead of registering */
  clientId?: string
  clientSecret?: string
  open(url: string): unknown
  signal?: AbortSignal
  timeoutMs?: number
}

export async function signIn(o: SignInOpts): Promise<OAuthState> {
  const stopped = () => { if (o.signal?.aborted) throw new Error(t('Sign-in was stopped.')) }
  stopped()
  const { meta, resource, scope } = await discover(o.serverUrl, o.wwwAuthenticate)
  stopped()
  const server = createServer()
  // the port the saved client was registered with first, then Hob's usual one, then any
  const savedPort = Number(o.saved?.client.redirect_uri.match(/:(\d+)\//)?.[1]) || undefined
  let port = 0
  for (const p of [...new Set([savedPort, CALLBACK_PORT, 0])].filter((x): x is number => x !== undefined)) {
    try { port = await listen(server, p); break } catch { /* taken */ }
  }
  try {
    const redirect = `http://127.0.0.1:${port}/callback`
    const client: OAuthClient = o.clientId
      ? { client_id: o.clientId, ...(o.clientSecret ? { client_secret: o.clientSecret } : {}), redirect_uri: redirect }
      : o.saved?.client.redirect_uri === redirect && o.saved.token_endpoint === meta.token_endpoint ? o.saved.client : await register(meta, redirect)
    stopped()
    const verifier = b64url(randomBytes(32))
    const state = b64url(randomBytes(16))
    const url = new URL(meta.authorization_endpoint)
    const q: Record<string, string> = {
      response_type: 'code', client_id: client.client_id, redirect_uri: redirect,
      code_challenge: b64url(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
      state, resource, ...(scope ? { scope } : {}),
    }
    for (const [k, v] of Object.entries(q)) url.searchParams.set(k, v)

    let cleanup = () => {}
    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(t('Sign-in took too long. Try again.'))), o.timeoutMs ?? SIGN_IN_MS)
      const stop = () => reject(new Error(t('Sign-in was stopped.')))
      o.signal?.addEventListener('abort', stop, { once: true })
      cleanup = () => { clearTimeout(timer); o.signal?.removeEventListener('abort', stop) }
      server.on('request', (req, res) => {
        const u = new URL(req.url ?? '/', redirect)
        if (u.pathname !== '/callback') { res.writeHead(404); res.end(); return }
        // another page can't finish (or cancel) this sign-in
        if (u.searchParams.get('state') !== state) { res.writeHead(400, { 'content-type': 'text/html' }); res.end(PAGE(t('Something went wrong'), t('This sign-in link is out of date. Go back to Hob and try again.'))); return }
        const err = u.searchParams.get('error')
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end(err ? PAGE(t('Not connected'), t('You can close this tab and go back to Hob.')) : PAGE(t("You're signed in"), t('You can close this tab and go back to Hob.')))
        clearTimeout(timer)
        if (err) reject(new Error(err === 'access_denied' ? t("You didn't allow Hob to connect.") : t('Sign-in failed: {error}', { error: u.searchParams.get('error_description') ?? err })))
        else resolve(u.searchParams.get('code') ?? '')
      })
      void Promise.resolve(o.open(url.toString())).catch(reject)
    }).finally(() => cleanup())
    const s: OAuthState = { authorization_endpoint: meta.authorization_endpoint, token_endpoint: meta.token_endpoint, resource, ...(scope ? { scope } : {}), client }
    return { ...s, tokens: await token(s, { grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: verifier }) }
  } finally {
    server.closeAllConnections()
    server.close()
  }
}
