/** Small fixes to model text before it's shown as Markdown. */
export function tidyMarkdown(text: string): string {
  let inCode = false
  return text.split('\n').map((line) => {
    if (/^\s*(```|~~~)/.test(line)) inCode = !inCode
    // "• item" on its own line is a list item Markdown doesn't know; without this, items run together in one paragraph
    return inCode ? line : line.replace(/^(\s*)[•●▪◦‣]\s+/, '$1- ')
  }).join('\n')
}
