/** How long a passage must be, repeated word for word, to count as the model looping. */
export const REPEAT_WINDOW = 160

/** How many copies in a row make a loop. Twice happens in real answers (the same meeting every day). */
export const REPEAT_COPIES = 3

/**
 * Where text started repeating itself (the start of the second copy), or -1.
 * Short repeats (list items, phrases) are normal, and so is a long passage showing up again; the same
 * long passage back to back, three times over, means the model is stuck.
 */
export function repeatCut(text: string, window = REPEAT_WINDOW): number {
  if (text.length < 2 * window) return -1
  const end = text.length - window
  const prev = text.lastIndexOf(text.slice(end), end - 1)
  if (prev === -1) return -1
  const period = end - prev
  // walk back to where the repeating pattern begins; the second copy starts one period later
  let start = prev
  while (start > 0 && text[start - 1] === text[start - 1 + period]) start--
  if (text.length - start < REPEAT_COPIES * period) return -1
  return start + period
}
