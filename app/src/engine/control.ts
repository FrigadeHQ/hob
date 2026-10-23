/**
 * Gemma 4 sometimes writes its own control tags as text: the end of its thinking (`<channel|>`), or a made-up
 * tool result (`<tool_response>…`), e.g. after the thinking budget cut its thought short. They never belong in
 * a reply. Only the exact tags are matched, so `<b>` or `a < b` in an answer stay as written.
 */
const TAGS = ['<|channel>', '<|turn>', '<|tool_call>', '<|tool>', '<|think>', '<channel|>', '<turn|>', '<tool_call|>', '<tool|>', '<think|>', '</tool_response>']
const RESPONSE_OPEN = '<tool_response>'
const RESPONSE_ENDS = ['</tool_response>', '<tool_call|>']
const END_OF_THOUGHT = '<channel|>'

const escape = (s: string) => s.replace(/[|/]/g, '\\$&')
const ANY_TAG = new RegExp(TAGS.map(escape).join('|'), 'g')
const MADE_UP_RESULT = new RegExp(`${RESPONSE_OPEN}[\\s\\S]*?(${RESPONSE_ENDS.map(escape).join('|')}|$)`, 'g')
const OPEN_THOUGHT = /<\|channel>(thought\n?)?[\s\S]*?(<channel\|>|$)/g

/**
 * In long chats Gemma sometimes opens its thinking with a made-up tag, as text (`<thought`, `<think>`), and the
 * thought turned into the reply. At the very start of a reply, these mean thinking up to its end (or all of it).
 */
const OPENERS = ['<|channel>thought', '<|channel|>thought', '<channel>thought', '<channel|>thought', '<|thought|>', '<|thought>', '<thought>', '<thought', '<think>', '<think']
const CLOSERS = ['<channel|>', '</thought>', '</think>', '<|/thought|>']

/** the opener a reply starts with: its length, 'maybe' while more text could still make one, or 0 */
function opener(text: string, final: boolean): number | 'maybe' {
  for (const o of OPENERS) {
    if (text.startsWith(o)) {
      const next = text[o.length]
      if (next === undefined) { if (!final && /\w$/.test(o)) return 'maybe'; return o.length }
      if (!/\w$/.test(o) || !/[\w-]/.test(next)) return o.length
    } else if (!final && o.startsWith(text)) return 'maybe'
  }
  return 0
}

function firstCloser(text: string): [number, number] | undefined {
  return CLOSERS.map((c) => [text.indexOf(c), c.length] as [number, number]).filter(([i]) => i !== -1).sort((a, b) => a[0] - b[0])[0]
}

/** the reply without control tags; text before the last end-of-thinking tag was thinking, not the answer */
export function cleanAnswer(text: string): string {
  let t = text
  const start = t.trimStart()
  const open = opener(start, true)
  if (typeof open === 'number' && open > 0) {
    const rest = start.slice(open)
    const close = firstCloser(rest)
    t = close ? rest.slice(close[0] + close[1]) : ''
  }
  t = t.replace(MADE_UP_RESULT, '').replace(OPEN_THOUGHT, END_OF_THOUGHT)
  const i = t.lastIndexOf(END_OF_THOUGHT)
  if (i !== -1) {
    const after = t.slice(i + END_OF_THOUGHT.length)
    t = after.replace(ANY_TAG, '').trim() ? after : t.slice(0, i)
  }
  return t.replace(ANY_TAG, '').trim()
}

/** the same while streaming: a `<` that could start a tag is held back until it's clear; a thought goes to onThought */
export function streamCleaner(onThought: (text: string) => void = () => {}) {
  let buf = ''
  let inResult = false
  let state: 'start' | 'thought' | 'answer' = 'start'
  const push = (chunk: string) => {
    buf += chunk
    let out = ''
    for (;;) {
      if (state === 'start') {
        const s = buf.trimStart()
        if (!s) return out
        const open = opener(s, false)
        if (open === 'maybe') return out
        if (open > 0) { buf = s.slice(open); state = 'thought' } else { buf = s; state = 'answer' }
        continue
      }
      if (state === 'thought') {
        const close = firstCloser(buf)
        if (!close) {
          // keep a tail that could be the start of a closing tag
          const keep = Math.min(buf.length, 12)
          if (buf.length > keep) onThought(buf.slice(0, buf.length - keep))
          buf = buf.slice(buf.length - keep)
          return out
        }
        if (close[0] > 0) onThought(buf.slice(0, close[0]))
        // what follows starts like a new reply (its leading blank lines go)
        buf = buf.slice(close[0] + close[1])
        state = 'start'
        continue
      }
      if (inResult) {
        const ends = RESPONSE_ENDS.map((e) => [buf.indexOf(e), e.length]).filter(([i]) => i !== -1).sort((a, b) => a[0] - b[0])
        if (!ends.length) { buf = buf.slice(-16); return out }
        buf = buf.slice(ends[0][0] + ends[0][1]); inResult = false
        continue
      }
      const i = buf.indexOf('<')
      if (i === -1) { out += buf; buf = ''; return out }
      out += buf.slice(0, i); buf = buf.slice(i)
      const tag = TAGS.find((t) => buf.startsWith(t))
      if (tag) { buf = buf.slice(tag.length); continue }
      if (buf.startsWith(RESPONSE_OPEN)) { buf = buf.slice(RESPONSE_OPEN.length); inResult = true; continue }
      if ([...TAGS, RESPONSE_OPEN].some((t) => t.startsWith(buf))) return out
      out += '<'; buf = buf.slice(1)
    }
  }
  const end = () => {
    let rest = inResult ? '' : buf
    if (state === 'start' && opener(rest.trimStart(), true)) { onThought(rest.trimStart()); rest = '' }
    if (state === 'thought') { if (rest) onThought(rest); rest = '' }
    buf = ''
    return rest
  }
  return { push, end }
}
