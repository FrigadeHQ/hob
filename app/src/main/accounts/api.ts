/** A signed-in account's web API: JSON in, JSON out. A missing item (404) is undefined; other failures throw. */
export type Api = (url: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }, signal?: AbortSignal) => Promise<any>

/** the user's own time zone, for events added without one */
export const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
/** "2026-10-21T15:00" one hour later, in the same form */
export function plusHour(start: string): string {
  const d = new Date(start)
  if (isNaN(d.getTime())) return start
  const e = new Date(d.getTime() + 3_600_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${e.getFullYear()}-${pad(e.getMonth() + 1)}-${pad(e.getDate())}T${pad(e.getHours())}:${pad(e.getMinutes())}`
}
/** "2026-10-21T15:00(:00)" as given, without any zone: the event's time is the user's local time */
export const localTime = (s: string) => s.replace(/(Z|[+-]\d\d:?\d\d)$/, '').slice(0, 19)
export const dateOnly = (s: string) => s.slice(0, 10)
/** a calendar search: every word must appear */
export const matches = (q: string | undefined, ...texts: (string | undefined)[]) => !q || q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => texts.some((t) => t?.toLowerCase().includes(w)))
