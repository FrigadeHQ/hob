/** What Hob says when a turn didn't produce an answer. The UI offers Retry under these only. */
export const FAILED = 'Something went wrong. Try again.'
export const NO_ANSWER = "I couldn't come up with an answer. Try rephrasing."
export const REPEATING = '*I started repeating myself, so I stopped. Try asking again, a bit more specifically.*'

export function failedReply(content: string): boolean {
  return content === FAILED || content === NO_ANSWER || content.endsWith(REPEATING)
}
