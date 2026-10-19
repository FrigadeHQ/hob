/**
 * One readable line of the model's reasoning: the last complete sentence while the next is still a
 * fragment, otherwise the sentence in progress, trimmed from the front at a word boundary.
 */
export function thinkingPreview(text: string, max = 140): string {
  const sentences = text.trim().split(/(?<=[.!?…:])\s+/).filter(Boolean)
  if (!sentences.length) return ''
  let line = sentences.at(-1)!
  if (sentences.length > 1 && line.length < 40) line = sentences.at(-2)!
  line = line.replace(/\s+/g, ' ')
  if (line.length <= max) return line
  const tail = line.slice(-max)
  return `…${tail.slice(tail.indexOf(' ') + 1)}`
}
