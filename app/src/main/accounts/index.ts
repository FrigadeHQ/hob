import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { Api } from './api'
import { googleCalMail } from './google'
import { microsoftCalMail } from './microsoft'
import { PROVIDERS, type Provider, type ProviderId } from './providers'
import { emailOf, signIn, tokenRequest, type Tokens } from './signin'
import type { CalMail } from './types'

export type Account = { provider: ProviderId; email: string }
type Saved = Account & { tokens: Tokens }
export type AccountsDeps = {
  /** where the (encrypted) sign-in is kept */
  file: string
  /** the system keychain (Electron safeStorage); plain when the system has none */
  encrypt(s: string): Buffer
  decrypt(b: Buffer): string
  open(url: string): Promise<void>
  fetch?: typeof fetch
  providers?: Record<ProviderId, Provider>
}

/** what the rest of Hob uses (tests and fake mode have their own) */
export type AccountsLike = Pick<Accounts, 'available' | 'current' | 'signIn' | 'cancelSignIn' | 'signOut' | 'calMail'>

/** The Google or Microsoft account Hob reads calendar and email from: sign in, stay signed in, sign out. */
export class Accounts {
  private saved: Saved | undefined
  private signingIn: AbortController | undefined
  constructor(private d: AccountsDeps) {
    try { if (existsSync(d.file)) this.saved = JSON.parse(d.decrypt(readFileSync(d.file))) as Saved } catch { this.saved = undefined }
  }
  private get providers() { return this.d.providers ?? PROVIDERS }
  private get fetch() { return this.d.fetch ?? fetch }
  private save() {
    if (this.saved) writeFileSync(this.d.file, this.d.encrypt(JSON.stringify(this.saved)), { mode: 0o600 })
    else rmSync(this.d.file, { force: true })
  }

  /** the providers Hob can sign in to (those with an app registration) */
  available(): ProviderId[] { return (Object.values(this.providers) as Provider[]).filter((p) => p.clientId).map((p) => p.id) }
  current(): Account | undefined { return this.saved && { provider: this.saved.provider, email: this.saved.email } }

  async signIn(id: ProviderId): Promise<Account> {
    const p = this.providers[id]
    if (!p?.clientId) throw new Error(`Signing in with ${p?.name ?? id} isn't available in this version of Hob.`)
    this.signingIn?.abort()
    const ac = (this.signingIn = new AbortController())
    try {
      const tokens = await signIn(p, this.d.open, this.fetch, ac.signal)
      this.saved = { provider: id, email: emailOf(tokens) || p.name, tokens }
      this.save()
      return this.current()!
    } finally { if (this.signingIn === ac) this.signingIn = undefined }
  }
  cancelSignIn() { this.signingIn?.abort() }
  signOut() { this.saved = undefined; this.save() }

  /** calendar and email of the signed-in account */
  calMail(): CalMail | undefined {
    const s = this.saved
    if (!s) return undefined
    return s.provider === 'google' ? googleCalMail(this.api(), s.email) : microsoftCalMail(this.api(), s.email)
  }

  private async token(force = false): Promise<string> {
    const s = this.saved
    if (!s) throw new Error('Not signed in.')
    const fresh = !s.tokens.expires_at || s.tokens.expires_at - 60_000 > Date.now()
    if (fresh && !force) return s.tokens.access_token
    if (!s.tokens.refresh_token) throw new Error(`Hob's sign-in to ${this.providers[s.provider].name} ran out. Sign in again in Settings → Plugins → Calendar & Mail.`)
    try {
      const t = await tokenRequest(this.fetch, this.providers[s.provider], { grant_type: 'refresh_token', refresh_token: s.tokens.refresh_token })
      // providers may or may not send a new refresh token
      s.tokens = { ...t, refresh_token: t.refresh_token ?? s.tokens.refresh_token }
      this.save()
      return t.access_token
    } catch (err) {
      // revoked or expired for good: signed out, and the user is told how to sign in again
      if ((err as { code?: string }).code === 'invalid_grant') { this.saved = undefined; this.save() }
      throw new Error(`Hob couldn't stay signed in to ${this.providers[s.provider].name}. Sign in again in Settings → Plugins → Calendar & Mail.`)
    }
  }

  private api(): Api {
    return async (url, init = {}, signal) => {
      const go = async (token: string) => this.fetch(url, {
        method: init.method ?? 'GET', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
        headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...init.headers },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      })
      let r = await go(await this.token())
      if (r.status === 401) r = await go(await this.token(true))
      if (r.status === 404) return undefined
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: { message?: string } | string }
        const msg = typeof j.error === 'string' ? j.error : j.error?.message
        throw new Error(r.status === 403 ? `${this.providers[this.saved?.provider ?? 'google'].name} didn't allow this${msg ? `: ${msg}` : ''}.` : msg || `The request failed (${r.status}).`)
      }
      return r.status === 204 ? undefined : r.json()
    }
  }
}
