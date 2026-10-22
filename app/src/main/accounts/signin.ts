import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Provider } from './providers'

export type Tokens = { access_token: string; refresh_token?: string; expires_at?: number; id_token?: string }
const SIGN_IN_MS = 5 * 60_000

const PAGE = (title: string, text: string) => `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px -apple-system,Segoe UI,sans-serif;display:grid;place-items:center;height:90vh;color:#1C1C1C;background:#FAFAFA"><div style="text-align:center"><h1 style="font-size:22px">${title}</h1><p>${text}</p></div>`

/** a token endpoint's answer, with when the access token runs out */
export async function tokenRequest(fetchFn: typeof fetch, p: Provider, form: Record<string, string>): Promise<Tokens> {
  const body = new URLSearchParams({ client_id: p.clientId, ...(p.clientSecret ? { client_secret: p.clientSecret } : {}), ...form })
  const r = await fetchFn(p.tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body, signal: AbortSignal.timeout(20_000) })
  const j = (await r.json().catch(() => ({}))) as Tokens & { expires_in?: number; error?: string; error_description?: string }
  if (!r.ok || !j.access_token) throw Object.assign(new Error(j.error_description || j.error || `Sign-in failed (${r.status})`), { code: j.error })
  return { access_token: j.access_token, refresh_token: j.refresh_token, id_token: j.id_token, ...(j.expires_in ? { expires_at: Date.now() + j.expires_in * 1000 } : {}) }
}

/** the email in a sign-in's ID token (it came straight from the provider over HTTPS) */
export function emailOf(t: Tokens): string {
  try {
    const claims = JSON.parse(Buffer.from((t.id_token ?? '').split('.')[1] ?? '', 'base64url').toString()) as { email?: string; preferred_username?: string }
    return claims.email ?? claims.preferred_username ?? ''
  } catch { return '' }
}

/**
 * Sign in the way desktop apps do (OAuth 2.0 for native apps, RFC 8252): open the provider's page in the
 * user's browser, and catch the answer on a one-time local address. PKCE ties the answer to this sign-in.
 */
export async function signIn(p: Provider, open: (url: string) => Promise<void>, fetchFn: typeof fetch = fetch, signal?: AbortSignal): Promise<Tokens> {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = randomBytes(16).toString('base64url')
  let done: (r: { code?: string; error?: string }) => void = () => {}
  const answer = new Promise<{ code?: string; error?: string }>((r) => { done = r })
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (u.pathname !== '/' || (!u.searchParams.has('code') && !u.searchParams.has('error'))) { res.writeHead(404).end(); return }
    if (u.searchParams.get('state') !== state) { res.writeHead(400).end(); return }
    const error = u.searchParams.get('error') ?? undefined
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(error
      ? PAGE('Not connected', 'Nothing was shared with Hob. You can close this tab.')
      : PAGE('You’re connected', 'You can close this tab and go back to Hob.'))
    done({ code: u.searchParams.get('code') ?? undefined, error })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const redirect = `http://${p.host}:${(server.address() as AddressInfo).port}`
  const timer = setTimeout(() => done({ error: 'timeout' }), SIGN_IN_MS)
  const stop = () => done({ error: 'cancelled' })
  signal?.addEventListener('abort', stop, { once: true })
  try {
    const url = new URL(p.authUrl)
    for (const [k, v] of Object.entries({ client_id: p.clientId, redirect_uri: redirect, response_type: 'code', scope: p.scopes.join(' '), state, code_challenge: challenge, code_challenge_method: 'S256', ...p.extra })) url.searchParams.set(k, v)
    await open(url.toString())
    const r = await answer
    if (r.error === 'timeout') throw new Error('Signing in took too long. Try again.')
    if (r.error === 'cancelled') throw new Error('Sign-in cancelled.')
    if (r.error || !r.code) throw new Error(`${p.name} didn't connect: ${r.error === 'access_denied' ? 'access was not allowed' : r.error ?? 'no answer'}.`)
    return await tokenRequest(fetchFn, p, { grant_type: 'authorization_code', code: r.code, code_verifier: verifier, redirect_uri: redirect })
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', stop)
    server.close()
  }
}
