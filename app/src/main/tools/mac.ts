import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Tool } from '../agent/tool'
import type { CalEvent, CalMail, FoundMail, Mail, NewEvent } from '../accounts/types'

/**
 * Calendar and email tools. They work with whichever source is connected (accounts/types.ts): a Google or
 * Microsoft account the user signed in to, or on a Mac the Calendar and Mail apps with every account the Mac has.
 * The Mac source: Calendar through Hob's helper (EventKit), Mail through the Mail app (JavaScript for
 * Automation). Hob never sends mail: it writes drafts the user sends.
 */
export type MacDeps = {
  /** native/hob-mac: JSON out, or a readable error */
  helper(args: string[], signal?: AbortSignal): Promise<unknown>
  /** a script for the Mail app; returns what it printed */
  mail(script: string, args: string[], signal?: AbortSignal): Promise<string>
}

export function macHelperPath(): string {
  const candidates = [
    process.resourcesPath && join(process.resourcesPath, 'bin', 'hob-mac'),
    join(__dirname, '../../resources/bin/hob-mac'),
    join(__dirname, '../../../resources/bin/hob-mac'),
  ].filter((x): x is string => !!x)
  return candidates.find((c) => existsSync(c)) ?? candidates.at(-1)!
}

export const realMacDeps: MacDeps = {
  helper: (args, signal) => new Promise((resolve, reject) => {
    execFile(macHelperPath(), args, { timeout: 150_000, signal, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr.trim() || err.message))
      try { resolve(JSON.parse(stdout)) } catch { reject(new Error('The Calendar helper gave an answer Hob could not read.')) }
    })
  }),
  mail: (script, args, signal) => new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script, ...args], { timeout: 120_000, signal, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout.trim())
      const e = stderr.trim()
      reject(new Error(/-1743|not allowed|Not authorized/i.test(e)
        ? "Hob isn't allowed to use Mail yet. Allow it in System Settings → Privacy & Security → Automation → Hob → Mail."
        : /-600|isn.t running/i.test(e) ? 'Mail needs to be set up on this Mac (open Mail and add your account).' : e || err.message))
    })
  }),
}

let deps: MacDeps = realMacDeps
/** tests: talk to fakes instead of Calendar and Mail */
export const setMacDeps = (d: MacDeps) => { deps = d }

/** the Mac's Calendar and Mail apps as a source */
export const macCalMail: CalMail = {
  name: 'the Calendar and Mail apps on this Mac',
  events: async (from, to, query, signal) => await deps.helper(['events', from, to, ...(query ? [query] : [])], signal) as CalEvent[],
  addEvent: async (e, signal) => await deps.helper(['add-event', JSON.stringify(e)], signal) as { title: string; start: string; calendar: string },
  searchMail: async (query, limit, signal) => (JSON.parse(await deps.mail(SEARCH, [query, String(limit)], signal)) as (Omit<FoundMail, 'id'> & { id: number })[]).map((m) => ({ ...m, id: String(m.id) })),
  readMail: async (id, signal) => { const m = JSON.parse(await deps.mail(READ, [id], signal)) as Mail & { missing?: boolean }; return m.missing ? undefined : m },
  draft: async (to, subject, body, signal) => { await deps.mail(DRAFT, [to, subject, body], signal); return 'open in Mail' },
}

/** the source the tools use: a signed-in account, else the Mac's apps; undefined: nothing connected */
let source: () => CalMail | undefined = () => (process.platform === 'darwin' ? macCalMail : undefined)
export const setCalMailSource = (s: () => CalMail | undefined) => { source = s }
const NOTHING = "Hob isn't connected to an email or calendar yet. Tell the user they can connect one: the “Connect my email and calendar” idea on the new chat screen, or Settings → Plugins → Calendar & Mail."
const use = () => source()

const when = (iso: string, allDay: boolean) => {
  const d = new Date(iso)
  return allDay ? d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
    : d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }

export const calendarEvents: Tool<{ from?: string; to?: string; query?: string }> = {
  spec: {
    name: 'calendar_events',
    description: "Look at the user's calendars: events between two dates, optionally matching words. Dates like 2026-10-21 or 2026-10-21T15:00. Defaults to the next 7 days.",
    params: { type: 'object', properties: {
      from: { type: 'string', description: 'Start date (default: today)' },
      to: { type: 'string', description: 'End date (default: 7 days after the start)' },
      query: { type: 'string', description: 'Only events whose title, place or notes have these words' },
    } },
  },
  title: (a) => (a.query ? `Searched your calendar for “${a.query}”` : 'Looked at your calendar'),
  action: () => ({ kind: 'run' }),
  async run(a, ctx) {
    const from = a.from?.trim() || startOfToday().toISOString()
    const to = a.to?.trim() || new Date(new Date(from).getTime() + 7 * 86_400_000).toISOString()
    const src = use()
    if (!src) return { text: NOTHING, failed: true }
    const events = await src.events(from, to, a.query?.trim() || undefined, ctx.signal)
    if (!events.length) return { text: `No events${a.query ? ` matching “${a.query}”` : ''} between ${when(from, true)} and ${when(to, true)}.` }
    const lines = events.map((e) => `- ${when(e.start, e.allDay)}${e.allDay ? ' (all day)' : `–${new Date(e.end).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`}: ${e.title} [${e.calendar}]${e.location ? ` · ${e.location}` : ''}${e.attendees?.length ? ` · with ${e.attendees.join(', ')}` : ''}${e.notes ? `\n  ${e.notes.replace(/\s+/g, ' ').slice(0, 200)}` : ''}`)
    // event notes and invites come from other people: treat them like web content
    ctx.untrusted = true
    return { text: `${events.length} event${events.length > 1 ? 's' : ''}:\n${lines.join('\n')}` }
  },
}

export const calendarAddEvent: Tool<NewEvent> = {
  spec: {
    name: 'calendar_add_event',
    description: "Add an event to the user's calendar. Dates like 2026-10-21T15:00 (local time). Without an end it lasts an hour. calendar: a calendar's name, or leave it out for their default one.",
    params: { type: 'object', properties: {
      title: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' },
      calendar: { type: 'string' }, location: { type: 'string' }, notes: { type: 'string' }, allDay: { type: 'boolean' },
    }, required: ['title', 'start'] },
  },
  title: (a) => `Added “${a.title}” to your calendar`,
  // it changes the user's calendar (and may invite nobody, but still): always ask
  action: () => ({ kind: 'app', ask: true }),
  ask: (a) => `Add “${a.title}” to your calendar${isNaN(Date.parse(a.start)) ? '' : ` on ${when(a.start, !!a.allDay)}`}?`,
  askDetail: (a) => [a.calendar && `Calendar: ${a.calendar}`, a.location && `Where: ${a.location}`, a.notes].filter(Boolean).join('\n'),
  async run(a, ctx) {
    const src = use()
    if (!src) return { text: NOTHING, failed: true }
    const r = await src.addEvent(a, ctx.signal)
    return { text: `Added “${r.title}” to the ${r.calendar} calendar on ${when(r.start, !!a.allDay)}.` }
  },
}

// Mail: one Apple event per property for the whole inbox is fast; one per message is not
const SEARCH = `function run(argv) {
  const q = (argv[0] || '').toLowerCase(), limit = Number(argv[1] || 25)
  const Mail = Application('Mail')
  const box = Mail.inbox.messages
  const ids = box.id(), subj = box.subject(), from = box.sender(), dates = box.dateReceived(), read = box.readStatus()
  const out = []
  for (let i = 0; i < ids.length; i++) {
    if (q && !((subj[i] || '').toLowerCase().includes(q) || (from[i] || '').toLowerCase().includes(q))) continue
    out.push({ id: ids[i], subject: subj[i], from: from[i], date: dates[i], read: read[i] })
  }
  out.sort((a, b) => new Date(b.date) - new Date(a.date))
  return JSON.stringify(out.slice(0, limit))
}`
const READ = `function run(argv) {
  const Mail = Application('Mail')
  const m = Mail.inbox.messages.whose({ id: Number(argv[0]) })()[0]
  if (!m) return JSON.stringify({ missing: true })
  return JSON.stringify({ subject: m.subject(), from: m.sender(), date: m.dateReceived(), to: m.toRecipients().map((r) => r.address()), content: (m.content() || '').slice(0, 12000) })
}`
const DRAFT = `function run(argv) {
  const Mail = Application('Mail')
  const m = Mail.OutgoingMessage({ subject: argv[1], content: argv[2], visible: true })
  Mail.outgoingMessages.push(m)
  for (const a of argv[0].split(',').map((s) => s.trim()).filter(Boolean)) m.toRecipients.push(Mail.Recipient({ address: a }))
  Mail.activate()
  return 'ok'
}`

export const mailSearch: Tool<{ query?: string; limit?: number }> = {
  spec: {
    name: 'mail_search',
    description: "Find emails in the user's inbox: by words in the subject or sender. Leave the query out for the latest emails. Returns ids for mail_read.",
    params: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number', description: 'How many, newest first (default 25)' } } },
  },
  title: (a) => (a.query ? `Searched your email for “${a.query}”` : 'Looked at your latest email'),
  action: () => ({ kind: 'run' }),
  async run(a, ctx) {
    const src = use()
    if (!src) return { text: NOTHING, failed: true }
    const found = await src.searchMail(a.query?.trim() ?? '', Math.min(Number(a.limit) || 25, 100), ctx.signal)
    ctx.untrusted = true
    if (!found.length) return { text: a.query ? `No emails matching “${a.query}” in the inbox.` : 'The inbox is empty.' }
    return { text: found.map((m) => `- [${m.id}] ${when(m.date, false)} · ${m.from} · ${m.subject}${m.read ? '' : ' (unread)'}`).join('\n') }
  },
}

export const mailRead: Tool<{ id: string }> = {
  spec: {
    name: 'mail_read',
    description: 'Read one email, by the id mail_search gave.',
    params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  title: () => 'Read an email',
  action: () => ({ kind: 'run' }),
  async run(a, ctx) {
    const src = use()
    if (!src) return { text: NOTHING, failed: true }
    const m = await src.readMail(String(a.id), ctx.signal)
    if (!m) return { text: `There's no email with id ${a.id} in the inbox. Search again.`, failed: true }
    // whatever an email says comes from someone else: it could try to steer Hob
    ctx.untrusted = true
    return { text: `From: ${m.from}\nTo: ${m.to.join(', ')}\nDate: ${when(m.date, false)}\nSubject: ${m.subject}\n\n${m.content}`, title: `Read “${m.subject}”` }
  },
}

export const mailDraft: Tool<{ to: string; subject: string; body: string }> = {
  spec: {
    name: 'mail_draft',
    description: 'Write an email as a draft, for the user to check and send. Hob never sends email itself.',
    params: { type: 'object', properties: { to: { type: 'string', description: 'Addresses, separated by commas' }, subject: { type: 'string' }, body: { type: 'string' } }, required: ['to', 'subject', 'body'] },
  },
  title: (a) => `Drafted an email to ${a.to}`,
  action: () => ({ kind: 'run' }),
  async run(a, ctx) {
    const src = use()
    if (!src) return { text: NOTHING, failed: true }
    const where = await src.draft(String(a.to ?? ''), String(a.subject ?? ''), String(a.body ?? ''), ctx.signal)
    return { text: `The draft to ${a.to} is saved (${where}), not sent. The user can check it and press Send.` }
  },
}

/** may Hob use Calendar and Mail? (no prompts) */
export async function macAccess(): Promise<{ calendar: string; mail: string }> {
  const [c, m] = await Promise.all([
    deps.helper(['calendar-status']).catch(() => ({ status: 'unavailable' })),
    deps.helper(['mail-status']).catch(() => ({ status: 'unavailable' })),
  ]) as { status: string }[]
  return { calendar: c.status, mail: m.status }
}
/** the system's own prompts, one after the other */
export async function askMacAccess(): Promise<{ calendar: string; mail: string }> {
  const c = await deps.helper(['calendar-auth']).catch(() => ({ status: 'unavailable' })) as { status: string }
  const m = await deps.helper(['mail-auth']).catch(() => ({ status: 'unavailable' })) as { status: string }
  return { calendar: c.status, mail: m.status }
}

export const macTools = (): Tool<any>[] => [calendarEvents, calendarAddEvent, mailSearch, mailRead, mailDraft]
