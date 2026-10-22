// a model's own control tags (Gemma 4 writes them into its thinking at times), and a tool call after one
const CONTROL = /<\|tool_call>call:[^\n]*|<\|[a-z_"]+>|<[a-z_"]+\|>/g
// lists, mappings ("`pdf` -> `PDFs`") and code read as noise on one line
const NOISE = /^\s*([-*•+]|\d+[.)])\s|->|→|=>|[{}[\]<>=]/
const unlink = (s: string) => s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
const unmark = (s: string) => unlink(s)
  .replace(/(\*\*|__|`|~~)/g, '')
  .replace(/(^|\s)[*_]([^*_\s][^*_]*?)[*_](?=[\s.,!?;:]|$)/g, '$1$2')
  .replace(/^\s*#+\s*/, '')
  .replace(/\s+/g, ' ').trim()
const wordy = (s: string) => s.split(' ').length >= 3 && (s.match(/[\p{L}\s]/gu)?.length ?? 0) / s.length >= 0.75

/**
 * One readable line of the model's reasoning, as plain text: the last complete sentence while the next is
 * still a fragment, otherwise the sentence in progress. Lists, code and a heading that introduces a list are
 * skipped; a long sentence is cut at the end, at a word, with "…".
 */
export function thinkingPreview(text: string, max = 140): string {
  const sentences = text.replace(CONTROL, '\n').split('\n')
    .filter((l) => l.trim() && !NOISE.test(unlink(l)))
    .flatMap((l) => l.split(/(?<=[.!?…])\s+/))
    .map(unmark)
    .filter((s) => s && !s.endsWith(':') && wordy(s))
  if (!sentences.length) return ''
  let line = sentences.at(-1)!
  if (sentences.length > 1 && line.length < 40 && !/[.!?…]$/.test(line)) line = sentences.at(-2)!
  if (line.length <= max) return line
  const cut = line.slice(0, max)
  return `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[\s,;:.–-]+$/, '')}…`
}
