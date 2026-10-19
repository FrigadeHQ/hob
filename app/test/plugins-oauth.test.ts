import { afterEach, expect, it } from 'vitest'
import { McpClient } from '../src/main/plugins/mcp'
import { refreshTokens, signIn, tokenFresh, type OAuthState } from '../src/main/plugins/oauth'
import { startHttpFixture } from './fixtures/mcp-http-server'

let fx: Awaited<ReturnType<typeof startHttpFixture>> | undefined
let client: McpClient | undefined
afterEach(async () => { client?.close(); await fx?.close(); fx = undefined; client = undefined })

/** stands in for the user's browser: follows the server's redirect back to Hob */
const browser = (opened: string[] = []) => async (url: string) => {
  opened.push(url)
  const r = await fetch(url, { redirect: 'manual' })
  const back = r.headers.get('location')
  if (back) await fetch(back)
}
const www = async (url: string) => (await fetch(url, { method: 'POST', body: '{}' })).headers.get('www-authenticate') ?? ''

it('signs in: finds the auth server, registers Hob, uses PKCE, and the token works', async () => {
  fx = await startHttpFixture({ auth: true })
  const opened: string[] = []
  const s = await signIn({ serverUrl: fx.url, wwwAuthenticate: await www(fx.url), open: browser(opened) })
  expect(fx.state.registered).toHaveLength(1)
  expect(fx.state.registered[0].redirect_uris[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
  const p = fx.state.authorizeParams!
  expect(p.get('code_challenge_method')).toBe('S256')
  expect(p.get('resource')).toBe(fx.url)
  expect(p.get('scope')).toBe('read')
  expect(opened[0]).toContain(`${fx.origin}/authorize?`)
  expect(s.tokens?.access_token).toMatch(/^access-/)
  expect(tokenFresh(s)).toBe(true)
  client = new McpClient({ url: fx.url, auth: { token: async () => s.tokens?.access_token, refresh: async () => false } })
  expect((await client.listTools()).length).toBe(1)
})

it('signing in again reuses the registered client', async () => {
  fx = await startHttpFixture({ auth: true })
  const first = await signIn({ serverUrl: fx.url, open: browser() })
  await signIn({ serverUrl: fx.url, saved: first, open: browser() })
  expect(fx.state.registered).toHaveLength(1)
})

it('finds the auth server without a WWW-Authenticate hint (well-known path)', async () => {
  fx = await startHttpFixture({ auth: true })
  const s = await signIn({ serverUrl: fx.url, open: browser() })
  expect(s.tokens?.access_token).toBeTruthy()
})

it('refreshes a token, and says so when the refresh is refused', async () => {
  fx = await startHttpFixture({ auth: true })
  const s = await signIn({ serverUrl: fx.url, open: browser() })
  const next = await refreshTokens(s)
  expect(next?.tokens?.access_token).not.toBe(s.tokens?.access_token)
  expect(fx.state.tokenRequests.at(-1)!.get('grant_type')).toBe('refresh_token')
  const bad: OAuthState = { ...s, tokens: { ...s.tokens!, refresh_token: 'nope' } }
  expect(await refreshTokens(bad)).toBeUndefined()
})

it('a server without self-registration gets a plain explanation', async () => {
  fx = await startHttpFixture({ auth: true, noRegistration: true })
  await expect(signIn({ serverUrl: fx.url, open: browser() })).rejects.toThrow(/API key/)
})

it('a client id from the config skips registration', async () => {
  fx = await startHttpFixture({ auth: true, noRegistration: true })
  const s = await signIn({ serverUrl: fx.url, clientId: 'my-app', open: browser() })
  expect(s.client.client_id).toBe('my-app')
  expect(fx.state.authorizeParams!.get('client_id')).toBe('my-app')
})

it('saying no in the browser ends sign-in with a clear message', async () => {
  fx = await startHttpFixture({ auth: true })
  const deny = async (url: string) => {
    const redirect = new URL(url).searchParams.get('redirect_uri')!
    await fetch(`${redirect}?error=access_denied&state=${new URL(url).searchParams.get('state')}`)
  }
  await expect(signIn({ serverUrl: fx.url, open: deny })).rejects.toThrow(/didn't allow/i)
})

it('a callback with the wrong state is ignored, and Stop ends the wait', async () => {
  fx = await startHttpFixture({ auth: true })
  const ac = new AbortController()
  const forged = async (url: string) => {
    const redirect = new URL(url).searchParams.get('redirect_uri')!
    const r = await fetch(`${redirect}?code=x&state=forged`)
    expect(r.status).toBe(400)
    ac.abort()
  }
  await expect(signIn({ serverUrl: fx.url, open: forged, signal: ac.signal })).rejects.toThrow(/stopped/i)
})

it('refuses a server whose metadata names another service (it would get that service’s token)', async () => {
  fx = await startHttpFixture({ auth: true, prmResource: 'https://mcp.linear.app/mcp' })
  const opened: string[] = []
  await expect(signIn({ serverUrl: fx.url, open: browser(opened) })).rejects.toThrow(/don't match/i)
  expect(opened).toEqual([])
})

it('Stop before the browser opens means it never opens', async () => {
  fx = await startHttpFixture({ auth: true })
  const ac = new AbortController()
  ac.abort()
  const opened: string[] = []
  await expect(signIn({ serverUrl: fx.url, open: browser(opened), signal: ac.signal })).rejects.toThrow(/stopped/i)
  expect(opened).toEqual([])
})
