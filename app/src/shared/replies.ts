import { msg, t } from './i18n'

/** What Hob says when a turn didn't produce an answer. The UI offers Retry under these only. */
export const FAILED = msg('Something went wrong. Try again.')
export const NO_ANSWER = msg("I couldn't come up with an answer. Try rephrasing.")
export const REPEATING = msg('*I started repeating myself, so I stopped. Try asking again, a bit more specifically.*')
/** after what was written so far, when the user stopped the reply */
export const STOPPED = msg('*Stopped.*')

export function failedReply(content: string): boolean {
  return content === FAILED || content === NO_ANSWER || content.endsWith(REPEATING)
}

/** A reply as shown: Hob's own lines in the interface's language (they're stored in English, to compare) */
export function shownReply(content: string): string {
  if (content === FAILED || content === NO_ANSWER) return t(content)
  const note = [REPEATING, STOPPED].find((n) => content.endsWith(n))
  return note ? content.slice(0, -note.length) + t(note) : content
}

/** A chat keeps the English placeholder title until it's named; shown in the interface's language */
export const shownTitle = (title: string) => (title === 'New chat' ? t('New chat') : title)

/** A name the person typed: one line, trimmed; empty when there's nothing left to keep */
export function tidyTitle(raw: string, max = 80): string {
  const next = String(raw).replace(/\s+/g, ' ').trim()
  return next.length > max ? `${next.slice(0, max - 1).trimEnd()}…` : next
}
