const CLOSE = '</think>'

/**
 * Small models sometimes emit a literal `</think>` as text, so the parser keeps
 * their real answer inside the thought segment. Recover it from there.
 */
export function finalAnswer(response: string, thought: string): string {
  if (response.trim()) return response.trim()
  const i = thought.lastIndexOf(CLOSE)
  return i === -1 ? '' : thought.slice(i + CLOSE.length).trim()
}
