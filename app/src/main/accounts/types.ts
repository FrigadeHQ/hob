/**
 * Where Hob reads the user's calendar and email: the Mac's own Calendar and Mail apps, or a Google or Microsoft
 * account the user signed in to. The tools (tools/mac.ts) talk to whichever is connected, the same way.
 */
export type CalEvent = { title: string; start: string; end: string; allDay: boolean; calendar: string; location?: string; notes?: string; attendees?: string[] }
export type NewEvent = { title: string; start: string; end?: string; calendar?: string; location?: string; notes?: string; allDay?: boolean }
export type FoundMail = { id: string; subject: string; from: string; date: string; read: boolean }
export type Mail = { subject: string; from: string; date: string; to: string[]; content: string }

export interface CalMail {
  /** shown to the model and in results: "the Calendar app", "your Google account" */
  name: string
  events(from: string, to: string, query: string | undefined, signal?: AbortSignal): Promise<CalEvent[]>
  addEvent(e: NewEvent, signal?: AbortSignal): Promise<{ title: string; start: string; calendar: string }>
  searchMail(query: string, limit: number, signal?: AbortSignal): Promise<FoundMail[]>
  /** undefined: no such email */
  readMail(id: string, signal?: AbortSignal): Promise<Mail | undefined>
  /** writes a draft the user sends themselves; where they'll find it */
  draft(to: string, subject: string, body: string, signal?: AbortSignal): Promise<string>
}
