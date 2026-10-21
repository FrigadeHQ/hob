/**
 * While a reply streams, every word is its own <span class="fw"> that fades in when it first appears.
 * React keeps the spans already on screen, so only new words animate: a soft trailing edge, like
 * Claude's. Code stays as it is.
 */
type Node = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: Node[] }

const SKIP = new Set(['code', 'pre'])

function wrap(node: Node) {
  if (!node.children || (node.tagName && SKIP.has(node.tagName))) return
  const out: Node[] = []
  for (const child of node.children) {
    if (child.type !== 'text' || !child.value) { wrap(child); out.push(child); continue }
    for (const part of child.value.split(/(\s+)/)) {
      if (!part) continue
      out.push(/^\s+$/.test(part) ? { type: 'text', value: part } : { type: 'element', tagName: 'span', properties: { className: ['fw'] }, children: [{ type: 'text', value: part }] })
    }
  }
  node.children = out
}

export const rehypeFadeWords = () => (tree: Node) => { wrap(tree) }
