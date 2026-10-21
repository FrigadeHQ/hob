import { expect, it } from 'vitest'
import { googleCalMail } from '../src/main/accounts/google'
import { microsoftCalMail } from '../src/main/accounts/microsoft'
import type { Api } from '../src/main/accounts/api'

/** a fake web API: answers by URL, records what was asked */
function fakeApi(routes: [RegExp, (url: string, init?: { method?: string; body?: unknown }) => unknown][]) {
  const calls: { url: string; method: string; body?: unknown }[] = []
  const api: Api = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body })
    const r = routes.find(([re]) => re.test(url))
    return r ? r[1](url, init) : undefined
  }
  return { api, calls }
}
const b64 = (s: string) => Buffer.from(s).toString('base64url')

it('Google: events from every calendar the user shows, sorted, cancelled ones and other words left out', async () => {
  const { api, calls } = fakeApi([
    [/calendarList/, () => ({ items: [{ id: 'me@gmail.com', summary: 'Me', primary: true }, { id: 'fam#1', summary: 'Family', selected: true }, { id: 'hidden', summary: 'Holidays' }] })],
    [/calendars\/me%40gmail\.com\/events/, () => ({ items: [{ summary: 'Dentist', start: { dateTime: '2026-10-22T09:00:00+02:00' }, end: { dateTime: '2026-10-22T10:00:00+02:00' }, attendees: [{ email: 'dr@x.com' }] }, { summary: 'Gone', status: 'cancelled', start: { dateTime: '2026-10-22T08:00:00Z' }, end: { dateTime: '2026-10-22T09:00:00Z' } }] })],
    [/calendars\/fam%231\/events/, () => ({ items: [{ summary: 'Birthday', start: { date: '2026-10-21' }, end: { date: '2026-10-22' } }] })],
  ])
  const g = googleCalMail(api, 'me@gmail.com')
  const ev = await g.events('2026-10-21', '2026-10-28', undefined)
  expect(ev.map((e) => [e.title, e.calendar, e.allDay])).toEqual([['Birthday', 'Family', true], ['Dentist', 'Me', false]])
  expect(ev[1].attendees).toEqual(['dr@x.com'])
  expect(calls.some((c) => c.url.includes('hidden'))).toBe(false)
  expect((await g.events('2026-10-21', '2026-10-28', 'dentist')).map((e) => e.title)).toEqual(['Dentist'])
})

it('Google: adds an event at local time in the named calendar, an hour long by default', async () => {
  const { api, calls } = fakeApi([
    [/calendarList/, () => ({ items: [{ id: 'me@gmail.com', summary: 'Me', primary: true }, { id: 'w', summary: 'Work' }] })],
    [/calendars\/w\/events/, (_u, init) => ({ summary: 'Standup', start: (init!.body as { start: unknown }).start })],
  ])
  const r = await googleCalMail(api, 'me@gmail.com').addEvent({ title: 'Standup', start: '2026-10-23T09:30', calendar: 'work' })
  expect(r.calendar).toBe('Work')
  const body = calls.at(-1)!.body as { start: { dateTime: string; timeZone: string }; end: { dateTime: string } }
  expect(body.start.dateTime).toBe('2026-10-23T09:30')
  expect(body.end.dateTime).toBe('2026-10-23T10:30')
  expect(body.start.timeZone).toBeTruthy()
})

it('Gmail: searches the inbox, reads the plain text, writes a draft (never sends)', async () => {
  const { api, calls } = fakeApi([
    [/messages\?/, () => ({ messages: [{ id: 'm1' }] })],
    [/messages\/m1\?format=metadata/, () => ({ id: 'm1', labelIds: ['INBOX', 'UNREAD'], payload: { headers: [{ name: 'Subject', value: 'Your flight' }, { name: 'From', value: 'TAP <a@tap.pt>' }, { name: 'Date', value: 'Tue, 20 Oct 2026 08:00:00 +0000' }] } })],
    [/messages\/m1\?format=full/, () => ({ id: 'm1', payload: { headers: [{ name: 'Subject', value: 'Your flight' }, { name: 'To', value: 'me@gmail.com' }], mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/html', body: { data: b64('<p>html</p>') } }, { mimeType: 'text/plain', body: { data: b64('Departs 07:15') } }] } })],
    [/drafts/, () => ({ id: 'd1' })],
  ])
  const g = googleCalMail(api, 'me@gmail.com')
  const found = await g.searchMail('flight', 10)
  expect(found).toEqual([{ id: 'm1', subject: 'Your flight', from: 'TAP <a@tap.pt>', date: '2026-10-20T08:00:00.000Z', read: false }])
  expect(new URL(calls[0].url).searchParams.get('q')).toBe('in:inbox flight')
  expect((await g.readMail('m1'))?.content).toBe('Departs 07:15')
  expect(await g.readMail('../etc')).toBeUndefined()
  await g.draft('ann@x.com', 'Hej Ærø', 'See you')
  const raw = Buffer.from((calls.at(-1)!.body as { message: { raw: string } }).message.raw, 'base64url').toString()
  expect(raw).toContain('To: ann@x.com')
  expect(raw).toContain('=?UTF-8?B?')
  expect(calls.every((c) => !c.url.includes('/send'))).toBe(true)
})

it('Microsoft: events in UTC, searched by words; mail search, read and a draft', async () => {
  const { api, calls } = fakeApi([
    [/calendarView/, () => ({ value: [{ subject: 'Dentist', start: { dateTime: '2026-10-22T07:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-10-22T08:00:00.0000000', timeZone: 'UTC' } }, { subject: 'Off', isAllDay: true, start: { dateTime: '2026-10-23T00:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-10-24T00:00:00.0000000', timeZone: 'UTC' } }] })],
    [/mailFolders\/inbox\/messages/, () => ({ value: [{ id: 'A1', subject: 'Old', from: { emailAddress: { name: 'Bo', address: 'bo@x.com' } }, receivedDateTime: '2026-10-01T00:00:00Z', isRead: true }, { id: 'B2', subject: 'New', from: { emailAddress: { address: 'cy@x.com' } }, receivedDateTime: '2026-10-20T00:00:00Z', isRead: false }] })],
    [/messages\/B2/, () => ({ id: 'B2', subject: 'New', from: { emailAddress: { address: 'cy@x.com' } }, toRecipients: [{ emailAddress: { address: 'me@outlook.com' } }], receivedDateTime: '2026-10-20T00:00:00Z', body: { content: 'Hello there' } })],
    [/\/me\/messages$/, () => ({ id: 'D' })],
  ])
  const m = microsoftCalMail(api, 'me@outlook.com')
  const ev = await m.events('2026-10-21', '2026-10-28', undefined)
  expect(ev.map((e) => [e.title, e.start, e.allDay])).toEqual([['Dentist', '2026-10-22T07:00:00Z', false], ['Off', '2026-10-23', true]])
  expect((await m.events('2026-10-21', '2026-10-28', 'dent')).map((e) => e.title)).toEqual(['Dentist'])
  expect((await m.searchMail('', 10)).map((x) => [x.id, x.from])).toEqual([['B2', 'cy@x.com'], ['A1', 'Bo <bo@x.com>']])
  expect((await m.readMail('B2'))?.content).toBe('Hello there')
  await m.draft('ann@x.com, bo@x.com', 'Hi', 'Body')
  expect(calls.at(-1)).toMatchObject({ method: 'POST', body: { toRecipients: [{ emailAddress: { address: 'ann@x.com' } }, { emailAddress: { address: 'bo@x.com' } }] } })
  expect(calls.every((c) => !c.url.includes('/send'))).toBe(true)
})

import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Accounts } from '../src/main/accounts'
import { PROVIDERS } from '../src/main/accounts/providers'

const idToken = (claims: object) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`
/** a pretend Google: the browser says yes at once; its token endpoint and calendar API answer */
function world() {
  const dir = mkdtempSync(join(tmpdir(), 'garth-accounts-'))
  const seen: { url: string; body?: string; auth?: string }[] = []
  let tokenCalls = 0
  let expired = false
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? String(init.body) : undefined
    seen.push({ url, body, auth: (init?.headers as Record<string, string> | undefined)?.authorization })
    if (url === PROVIDERS.google.tokenUrl) {
      tokenCalls++
      const form = new URLSearchParams(body)
      if (form.get('grant_type') === 'refresh_token' && form.get('refresh_token') === 'revoked') return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })
      return new Response(JSON.stringify({ access_token: `at${tokenCalls}`, expires_in: 3600, ...(form.get('grant_type') === 'authorization_code' ? { refresh_token: 'rt', id_token: idToken({ email: 'me@gmail.com' }) } : {}) }))
    }
    if (url.includes('calendarList')) {
      if (expired && (init?.headers as Record<string, string>).authorization === 'Bearer at1') return new Response('{}', { status: 401 })
      return new Response(JSON.stringify({ items: [] }))
    }
    return new Response('{}', { status: 404 })
  }) as typeof fetch
  // the "browser": follows the sign-in page straight back to Garth with a code
  const open = async (url: string) => {
    const u = new URL(url)
    const back = new URL(u.searchParams.get('redirect_uri')!)
    back.searchParams.set('code', 'the-code'); back.searchParams.set('state', u.searchParams.get('state')!)
    void fetch(back.toString().replace('localhost', '127.0.0.1'))
  }
  const providers = { google: { ...PROVIDERS.google, clientId: 'cid', clientSecret: 'public' }, microsoft: { ...PROVIDERS.microsoft, clientId: '' } }
  const make = () => new Accounts({ file: join(dir, 'accounts.bin'), encrypt: (s) => Buffer.from(`enc:${s}`), decrypt: (b) => b.toString().slice(4), open, fetch: fetchFn, providers })
  return { dir, seen, make, expire: () => { expired = true } }
}

it('signs in with Google in the browser (PKCE), keeps the sign-in encrypted, and only offers set-up providers', async () => {
  const w = world()
  const a = w.make()
  expect(a.available()).toEqual(['google'])
  expect(await a.signIn('google')).toEqual({ provider: 'google', email: 'me@gmail.com' })
  const form = new URLSearchParams(w.seen[0].body)
  expect(form.get('code')).toBe('the-code')
  expect(form.get('code_verifier')?.length).toBeGreaterThan(40)
  expect(readFileSync(join(w.dir, 'accounts.bin'), 'utf8').startsWith('enc:')).toBe(true)
  // a restart remembers it
  expect(w.make().current()).toEqual({ provider: 'google', email: 'me@gmail.com' })
  await expect(a.signIn('microsoft')).rejects.toThrow(/isn't available/)
})

it('refreshes a token that ran out, and signs out', async () => {
  const w = world()
  const a = w.make()
  await a.signIn('google')
  w.expire()
  await a.calMail()!.events('2026-10-21', '2026-10-22', undefined)
  expect(w.seen.filter((s) => s.url.includes('calendarList')).map((s) => s.auth)).toEqual(['Bearer at1', 'Bearer at2'])
  a.signOut()
  expect(a.current()).toBeUndefined()
  expect(w.make().current()).toBeUndefined()
})
