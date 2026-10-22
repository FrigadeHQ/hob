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

/** the reply without control tags; text before the last end-of-thinking tag was thinking, not the answer */
export function cleanAnswer(text: string): string {
  let t = text.replace(MADE_UP_RESULT, '').replace(OPEN_THOUGHT, END_OF_THOUGHT)
  const i = t.lastIndexOf(END_OF_THOUGHT)
  if (i !== -1) {
    const after = t.slice(i + END_OF_THOUGHT.length)
    t = after.replace(ANY_TAG, '').trim() ? after : t.slice(0, i)
  }
  return t.replace(ANY_TAG, '').trim()
}

/** the same while streaming: a `<` that could start a tag is held back until it's clear */
export function streamCleaner() {
  let buf = ''
  let inResult = false
  const push = (chunk: string) => {
    buf += chunk
    let out = ''
    for (;;) {
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
  const end = () => { const rest = inResult ? '' : buf; buf = ''; return rest }
  return { push, end }
}
