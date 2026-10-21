import { expect, it } from 'vitest'
import { rehypeFadeWords } from '../src/renderer/src/fadeWords'

it('wraps each word in a fading span, keeps spaces, and leaves code alone', () => {
  const tree = { type: 'root', children: [
    { type: 'element', tagName: 'p', children: [{ type: 'text', value: 'Hello big world' }, { type: 'element', tagName: 'strong', children: [{ type: 'text', value: ' bold' }] }] },
    { type: 'element', tagName: 'pre', children: [{ type: 'element', tagName: 'code', children: [{ type: 'text', value: 'x = 1' }] }] },
  ] }
  rehypeFadeWords()(tree)
  const p = tree.children[0] as { children: { type: string; tagName?: string; value?: string; children?: { value: string }[] }[] }
  expect(p.children.map((c) => c.tagName === 'span' ? `[${c.children![0].value}]` : c.type === 'text' ? c.value : `<${c.tagName}>`)).toEqual(['[Hello]', ' ', '[big]', ' ', '[world]', '<strong>'])
  const strong = p.children[5] as unknown as { children: { tagName?: string; value?: string }[] }
  expect(strong.children.map((c) => c.tagName ?? c.value)).toEqual([' ', 'span'])
  expect(JSON.stringify(tree.children[1])).toContain('"value":"x = 1"')
})
