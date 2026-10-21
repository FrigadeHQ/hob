import type { CalEvent, CalMail } from './types'
import { dateOnly, localTime, matches, plusHour, timeZone, type Api } from './api'

const GRAPH = 'https://graph.microsoft.com/v1.0/me'
// times come back in UTC, marked as such, so they read the same as the other sources
const UTC = { Prefer: 'outlook.timezone="UTC"' }

type MTime = { dateTime: string; timeZone: string }
type MEvent = { subject?: string; start: MTime; end: MTime; isAllDay?: boolean; isCancelled?: boolean; location?: { displayName?: string }; bodyPreview?: string; attendees?: { emailAddress: { address: string } }[] }
type MAddress = { emailAddress?: { name?: string; address?: string } }
type MMessage = { id: string; subject?: string; from?: MAddress; receivedDateTime?: string; isRead?: boolean; toRecipients?: MAddress[]; body?: { content?: string } }

const who = (a?: MAddress) => (a?.emailAddress?.name && a.emailAddress.address ? `${a.emailAddress.name} <${a.emailAddress.address}>` : a?.emailAddress?.address ?? a?.emailAddress?.name ?? '')
const utc = (t: MTime) => (t.dateTime.endsWith('Z') ? t.dateTime : `${t.dateTime.replace(/\.\d+$/, '')}Z`)

/** Outlook calendar and mail (Outlook.com, Hotmail, Microsoft 365), for a signed-in Microsoft account */
export function microsoftCalMail(api: Api, email: string): CalMail {
  return {
    name: `the Microsoft account ${email}`,
    async events(from, to, query, signal) {
      const q = new URLSearchParams({ startDateTime: new Date(from).toISOString(), endDateTime: new Date(to).toISOString(), $top: '250', $orderby: 'start/dateTime', $select: 'subject,start,end,isAllDay,isCancelled,location,bodyPreview,attendees' })
      const r = (await api(`${GRAPH}/calendarView?${q}`, { headers: UTC }, signal)) as { value?: MEvent[] } | undefined
      return (r?.value ?? []).filter((e) => !e.isCancelled && matches(query, e.subject, e.location?.displayName, e.bodyPreview)).map((e): CalEvent => ({
        title: e.subject ?? '(no title)', start: e.isAllDay ? dateOnly(e.start.dateTime) : utc(e.start), end: e.isAllDay ? dateOnly(e.end.dateTime) : utc(e.end), allDay: !!e.isAllDay, calendar: 'Calendar',
        ...(e.location?.displayName ? { location: e.location.displayName } : {}), ...(e.bodyPreview ? { notes: e.bodyPreview } : {}),
        ...(e.attendees?.length ? { attendees: e.attendees.map((x) => x.emailAddress.address) } : {}),
      }))
    },
    async addEvent(e, signal) {
      let path = `${GRAPH}/events`, calendar = 'Calendar'
      if (e.calendar) {
        const cals = ((await api(`${GRAPH}/calendars?$select=id,name`, {}, signal)) as { value?: { id: string; name: string }[] } | undefined)?.value ?? []
        const c = cals.find((x) => x.name.toLowerCase() === e.calendar!.toLowerCase())
        if (c) { path = `${GRAPH}/calendars/${c.id}/events`; calendar = c.name }
      }
      const tz = timeZone()
      const allDayEnd = () => { const d = new Date(`${dateOnly(e.end ?? e.start)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) }
      const start = e.allDay ? `${dateOnly(e.start)}T00:00:00` : localTime(e.start)
      const end = e.allDay ? `${allDayEnd()}T00:00:00` : localTime(e.end ?? plusHour(e.start))
      const made = (await api(path, {
        method: 'POST',
        body: { subject: e.title, isAllDay: !!e.allDay, start: { dateTime: start, timeZone: tz }, end: { dateTime: end, timeZone: tz }, ...(e.location ? { location: { displayName: e.location } } : {}), ...(e.notes ? { body: { contentType: 'text', content: e.notes } } : {}) },
      }, signal)) as MEvent
      return { title: made.subject ?? e.title, start: made.start ? utc(made.start) : e.start, calendar }
    },
    async searchMail(query, limit, signal) {
      const select = '$select=id,subject,from,receivedDateTime,isRead'
      // a search can't also be sorted: sort here
      const url = query
        ? `${GRAPH}/mailFolders/inbox/messages?$search=${encodeURIComponent(`"${query.replace(/"/g, '')}"`)}&$top=${limit}&${select}`
        : `${GRAPH}/mailFolders/inbox/messages?$orderby=receivedDateTime%20desc&$top=${limit}&${select}`
      const r = (await api(url, {}, signal)) as { value?: MMessage[] } | undefined
      return (r?.value ?? []).map((m) => ({ id: m.id, subject: m.subject ?? '', from: who(m.from), date: m.receivedDateTime ?? '', read: !!m.isRead }))
        .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    },
    async readMail(id, signal) {
      if (!/^[\w=+/-]+$/.test(id)) return undefined
      const m = (await api(`${GRAPH}/messages/${encodeURIComponent(id)}?$select=subject,from,toRecipients,receivedDateTime,body`, { headers: { Prefer: 'outlook.body-content-type="text"' } }, signal)) as MMessage | undefined
      if (!m) return undefined
      return { subject: m.subject ?? '', from: who(m.from), date: m.receivedDateTime ?? '', to: (m.toRecipients ?? []).map(who), content: (m.body?.content ?? '').slice(0, 12000) }
    },
    async draft(to, subject, body, signal) {
      await api(`${GRAPH}/messages`, {
        method: 'POST',
        body: { subject, body: { contentType: 'Text', content: body }, toRecipients: to.split(',').map((a) => a.trim()).filter(Boolean).map((address) => ({ emailAddress: { address } })) },
      }, signal)
      return 'in Outlook, under Drafts'
    },
  }
}
