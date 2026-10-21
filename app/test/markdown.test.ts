import { expect, it } from 'vitest'
import { tidyMarkdown } from '../src/shared/markdown'

it('"•" bullets the model typed become a real list', () => {
  expect(tidyMarkdown('**5 Key Points:**\n• **The problem**: one\n•  two\n  ◦ nested')).toBe('**5 Key Points:**\n- **The problem**: one\n- two\n  - nested')
})

it('leaves code blocks and bullets inside sentences alone', () => {
  const code = '```\n• not a list\n```'
  expect(tidyMarkdown(code)).toBe(code)
  expect(tidyMarkdown('Price • quality • speed')).toBe('Price • quality • speed')
})

it('<br> the model put in a table cell (or anywhere) becomes a line break, not literal text; code keeps it', () => {
  expect(tidyMarkdown('| Day | Activity |\n|---|---|\n| Day 1 | • Review notes.<br>• Do 10 exercises. |')).toBe('| Day | Activity |\n|---|---|\n| Day 1 | • Review notes. • Do 10 exercises. |')
  expect(tidyMarkdown('one<br/>two <BR />three')).toBe('one two  three')
  expect(tidyMarkdown('use `<br>` for a break')).toBe('use `<br>` for a break')
  expect(tidyMarkdown('```\na<br>b\n```')).toBe('```\na<br>b\n```')
})

it('line-break marks become <br> elements', async () => {
  const { rehypeLineBreaks } = await import('../src/renderer/src/lineBreaks')
  const tree = { type: 'root', children: [{ type: 'element', tagName: 'td', children: [{ type: 'text', value: 'a b' }] }] }
  rehypeLineBreaks()(tree as never)
  expect(tree.children[0].children).toEqual([{ type: 'text', value: 'a' }, { type: 'element', tagName: 'br', properties: {}, children: [] }, { type: 'text', value: 'b' }])
})
