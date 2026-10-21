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
