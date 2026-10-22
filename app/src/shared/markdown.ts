/** stands in for a line break Markdown can't express (inside a table cell); rehypeLineBreaks turns it into <br> */
export const LINE_BREAK = ' '

/** <br> outside `inline code` */
const breaks = (line: string) => line.split(/(`[^`]*`)/).map((part, i) => (i % 2 ? part : part.replace(/<br\s*\/?>/gi, LINE_BREAK))).join('')

/** Small fixes to model text before it's shown as Markdown. */
export function tidyMarkdown(text: string): string {
  let inCode = false
  return text.split('\n').map((line) => {
    if (/^\s*(```|~~~)/.test(line)) inCode = !inCode
    if (inCode) return line
    // "• item" on its own line is a list item Markdown doesn't know; without this, items run together in one paragraph
    // models write <br> for a new line in a table cell; Markdown would show it as text
    return breaks(line.replace(/^(\s*)[•●▪◦‣]\s+/, '$1- '))
  }).join('\n')
}

/**
 * Markdown that's still streaming in, made whole for display: an open **bold**, *italic*, ~~strike~~, `code`
 * or code block is closed for now, a marker with nothing after it yet is hidden, and a link still arriving
 * shows its words. Without this, "**" shows as text until the closing one arrives and the line then jumps
 * to bold. (The same idea as Streamdown's incomplete-Markdown handling.) Only for live text: finished replies
 * are shown as written.
 */
export function healMarkdown(text: string): string {
  // an open code block: close it; nothing inside it is formatting
  const fences = text.split('\n').filter((l) => /^\s*(```|~~~)/.test(l)).length
  if (fences % 2) return `${text}${text.endsWith('\n') ? '' : '\n'}\`\`\``
  // formatting doesn't run across paragraphs: only the one being written can be open
  const cut = text.lastIndexOf('\n\n') + 1
  const head = text.slice(0, cut)
  let block = text.slice(cut)
  // a marker with nothing after it yet ("Next up: **")
  block = block.replace(/(^|\s)(\*{1,3}|~~|`)$/, '$1')
  // a link still arriving: its words for now
  block = block.replace(/\[([^\]\n]*)\]\([^)\s]*$/, '$1').replace(/\[([^\]\n]*)$/, '$1')
  // inside `code` nothing counts; an open one gets closed
  const masked = block.replace(/`[^`\n]*`/g, (m) => 'x'.repeat(m.length))
  if ((masked.match(/`/g)?.length ?? 0) % 2) return `${head}${block}\``
  const opens = (ch: '*' | '~') => {
    let bold = false, italic = false, lastLen = 0, lastAtEnd = false
    for (const m of masked.matchAll(ch === '*' ? /\*+/g : /~~/g)) {
      const at = m.index ?? 0, len = m[0].length
      const before = masked[at - 1], after = masked[at + len]
      // "2 * 3" or a "* " bullet: not formatting
      if ((before === undefined || /\s/.test(before)) && (after === undefined || /\s/.test(after))) continue
      if (len >= 2) bold = !bold
      if (len % 2) italic = !italic
      lastLen = len; lastAtEnd = at + len === masked.length
    }
    return { bold, italic, lastLen, lastAtEnd }
  }
  const star = opens('*')
  const strike = opens('~').bold
  // half of a closing ** has arrived: finish it
  if (star.bold && star.italic && star.lastAtEnd && star.lastLen === 1) return `${head}${block}*`
  const close = `${star.italic ? '*' : ''}${star.bold ? '**' : ''}${strike ? '~~' : ''}`
  if (!close) return head + block
  // the closer goes before trailing spaces: "**very **" wouldn't count as closed
  const trail = /\s*$/.exec(block)![0]
  return `${head}${block.slice(0, block.length - trail.length)}${close}${trail}`
}

// on a line of its own: "[Chart: Total revenue by region]", "{chart}" (Gemma) or "![chart](sales.chart.json)"
const CHART_PLACEHOLDER = /^[ \t]*(\[[^\]\n]*\b(chart|graph|plot)\b[^\]\n]*\](?!\()|\{\{?[^}\n]*\b(chart|graph|plot)\b[^}\n]*\}\}?|!\[[^\]\n]*\]\([^)\n]*\.chart\.json\))[ \t]*$/gim

/** The reply cut at the lines where a model wrote its chart's placeholder: the charts go between the pieces. */
export const splitAtCharts = (text: string) => text.split(CHART_PLACEHOLDER).filter((_, i) => i % 4 === 0).map((p) => p.trim())

// "$x^2$", "$\alpha$", "$n$": looks like math. "$76,000 in July to $" doesn't (starts with a digit, has spaces at an end).
const LOOKS_LIKE_MATH = /^(?![\d\s])[^$\n]*[^\s$]$/
const MATHY = /[\\^_=]|^[a-zA-Z]$/

/**
 * LaTeX the way models write it, in the form Markdown's math support reads: \(…\) and \[…\] (which it doesn't
 * know) and $…$ that is really math. Single $ stays plain text otherwise, since replies are full of prices.
 */
export function withMath(text: string): string {
  // code (fenced or inline) is never math
  return text.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/).map((part, i) => {
    if (i % 2) return part
    return part
      .replace(/\s*\\\[\s*([\s\S]+?)\s*\\\]\s*/g, (_, m: string) => `\n\n$$\n${m}\n$$\n\n`)
      .replace(/\\\((.+?)\\\)/g, (_, m: string) => `$$${m.trim()}$$`)
      .replace(/(?<![$\\])\$([^$\n]+?)\$(?!\$)/g, (all, m: string) => (LOOKS_LIKE_MATH.test(m) && MATHY.test(m) ? `$$${m}$$` : all))
  }).join('')
}
