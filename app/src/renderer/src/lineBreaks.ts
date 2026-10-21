import { LINE_BREAK } from '../../shared/markdown'

/** The line-break marks tidyMarkdown leaves (for <br> in table cells) become real <br> elements. */
type Node = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: Node[] }

function split(node: Node) {
  if (!node.children || node.tagName === 'code' || node.tagName === 'pre') return
  node.children = node.children.flatMap((child) => {
    if (child.type !== 'text' || !child.value?.includes(LINE_BREAK)) { split(child); return [child] }
    return child.value.split(LINE_BREAK).flatMap((part, i): Node[] => [
      ...(i ? [{ type: 'element', tagName: 'br', properties: {}, children: [] }] : []),
      ...(part ? [{ type: 'text', value: part }] : []),
    ])
  })
}

export const rehypeLineBreaks = () => (tree: Node) => { split(tree) }
