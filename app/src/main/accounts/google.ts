import type { CalEvent, CalMail, FoundMail } from './types'
import { dateOnly, localTime, matches, plusHour, timeZone, type Api } from './api'

const CAL = 'https://www.googleapis.com/calendar/v3'
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'

type GCal = { id: string; summary: string; selected?: boolean; primary?: boolean }
type GTime = { dateTime?: string; date?: string }
type GEvent = { summary?: string; start: GTime; end: GTime; location?: string; description?: string; attendees?: { email: string }[]; status?: string }
type GPart = { mimeType?: string; body?: { data?: string }; parts?: GPart[] }
type GMessage = { id: string; labelIds?: string[]; payload?: GPart & { headers?: { name: string; value: string }[] } }

const header = (m: GMessage, name: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''
const decode = (data: string) => Buffer.from(data, 'base64url').toString('utf8')
const stripHtml = (h: string) => h.replace(/<(style|script)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>|<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{3,}/g, '\n\n').trim()
/** the readable text of an email: its plain-text part, or its HTML part as text */
function text(p: GPart | undefined): string {
  if (!p) return ''
  const all: GPart[] = []
  const walk = (x: GPart) => { all.push(x); x.parts?.forEach(walk) }
  walk(p)
  const plain = all.find((x) => x.mimeType === 'text/plain' && x.body?.data)
  if (plain) return decode(plain.body!.data!)
  const html = all.find((x) => x.mimeType === 'text/html' && x.body?.data)
  return html ? stripHtml(decode(html.body!.data!)) : ''
}
/** a header value with non-ASCII letters (RFC 2047) */
const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`)

/** Google Calendar and Gmail, for a signed-in Google account */
export function googleCalMail(api: Api, email: string): CalMail {
  const calendars = async (signal?: AbortSignal) => ((await api(`${CAL}/users/me/calendarList?minAccessRole=reader`, {}, signal)) as { items?: GCal[] } | undefined)?.items ?? []
  return {
    name: `the Google account ${email}`,
    async events(from, to, query, signal) {
      // the calendars they show in Google Calendar (their own, family, work…)
      const cals = (await calendars(signal)).filter((c) => c.selected || c.primary)
      const out: CalEvent[] = []
      for (const c of cals) {
        const q = new URLSearchParams({ timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250' })
        const r = (await api(`${CAL}/calendars/${encodeURIComponent(c.id)}/events?${q}`, {}, signal)) as { items?: GEvent[] } | undefined
        for (const e of r?.items ?? []) {
          if (e.status === 'cancelled' || !matches(query, e.summary, e.location, e.description)) continue
          out.push({
            title: e.summary ?? '(no title)', start: e.start.dateTime ?? e.start.date ?? '', end: e.end.dateTime ?? e.end.date ?? '', allDay: !!e.start.date, calendar: c.summary,
            ...(e.location ? { location: e.location } : {}), ...(e.description ? { notes: stripHtml(e.description) } : {}),
            ...(e.attendees?.length ? { attendees: e.attendees.map((x) => x.email) } : {}),
          })
        }
      }
      return out.sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    },
    async addEvent(e, signal) {
      const cals = await calendars(signal)
      const cal = (e.calendar && cals.find((c) => c.summary.toLowerCase() === e.calendar!.toLowerCase())) || cals.find((c) => c.primary) || { id: 'primary', summary: email }
      const tz = timeZone()
      const end = e.end ?? (e.allDay ? e.start : plusHour(e.start))
      const when = (t: string) => (e.allDay ? { date: dateOnly(t) } : { dateTime: localTime(t), timeZone: tz })
      // an all-day event ends the day after its last day
      const allDayEnd = () => { const d = new Date(`${dateOnly(end)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return { date: d.toISOString().slice(0, 10) } }
      const made = (await api(`${CAL}/calendars/${encodeURIComponent(cal.id)}/events`, {
        method: 'POST',
        body: { summary: e.title, start: when(e.start), end: e.allDay ? allDayEnd() : when(end), ...(e.location ? { location: e.location } : {}), ...(e.notes ? { description: e.notes } : {}) },
      }, signal)) as GEvent
      return { title: made.summary ?? e.title, start: made.start.dateTime ?? made.start.date ?? e.start, calendar: cal.summary }
    },
    async searchMail(query, limit, signal) {
      const q = new URLSearchParams({ maxResults: String(limit), q: `in:inbox ${query}`.trim() })
      const list = ((await api(`${GMAIL}/messages?${q}`, {}, signal)) as { messages?: { id: string }[] } | undefined)?.messages ?? []
      const found: FoundMail[] = []
      for (const { id } of list) {
        const m = (await api(`${GMAIL}/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`, {}, signal)) as GMessage | undefined
        if (m) found.push({ id, subject: header(m, 'Subject'), from: header(m, 'From'), date: new Date(header(m, 'Date') || Date.now()).toISOString(), read: !m.labelIds?.includes('UNREAD') })
      }
      return found
    },
    async readMail(id, signal) {
      if (!/^[\w-]+$/.test(id)) return undefined
      const m = (await api(`${GMAIL}/messages/${id}?format=full`, {}, signal)) as GMessage | undefined
      if (!m) return undefined
      return { subject: header(m, 'Subject'), from: header(m, 'From'), date: new Date(header(m, 'Date') || Date.now()).toISOString(), to: header(m, 'To').split(',').map((s) => s.trim()).filter(Boolean), content: text(m.payload).slice(0, 12000) }
    },
    async draft(to, subject, body, signal) {
      const raw = Buffer.from([`To: ${to}`, `Subject: ${encodeHeader(subject)}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: 8bit', '', body].join('\r\n')).toString('base64url')
      await api(`${GMAIL}/drafts`, { method: 'POST', body: { message: { raw } } }, signal)
      return 'in Gmail, under Drafts'
    },
  }
}
