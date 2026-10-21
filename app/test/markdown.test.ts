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

it('heals Markdown that is still streaming in, so ** and friends never show as text', async () => {
  const { healMarkdown } = await import('../src/shared/markdown')
  // bold and italic still open: closed for now
  expect(healMarkdown('This is **very imp')).toBe('This is **very imp**')
  expect(healMarkdown('This is **very ')).toBe('This is **very** ')
  expect(healMarkdown('a *little')).toBe('a *little*')
  expect(healMarkdown('***both')).toBe('***both***')
  expect(healMarkdown('~~gone')).toBe('~~gone~~')
  // half of the closing ** has arrived
  expect(healMarkdown('**done*')).toBe('**done**')
  // a marker with nothing after it yet: hidden until its words arrive
  expect(healMarkdown('Next up: **')).toBe('Next up: ')
  expect(healMarkdown('Next up: *')).toBe('Next up: ')
  // code
  expect(healMarkdown('run `npm te')).toBe('run `npm te`')
  expect(healMarkdown('```python\nprint(1')).toBe('```python\nprint(1\n```')
  expect(healMarkdown('```\na ** b')).toBe('```\na ** b\n```')
  expect(healMarkdown('`a ** b` and **c')).toBe('`a ** b` and **c**')
  // a link still coming in shows its words, not brackets
  expect(healMarkdown('See [the exam')).toBe('See the exam')
  expect(healMarkdown('See [the exam](https://exa')).toBe('See the exam')
  // finished text is left alone; list bullets and earlier paragraphs too
  for (const done of ['**bold** and *it*', '* item\n* item two', 'Done.\n\n- a\n- b', '2 * 3 = 6', 'snake_case_name']) expect(healMarkdown(done)).toBe(done)
  expect(healMarkdown('**Para one**\n\n**Para t')).toBe('**Para one**\n\n**Para t**')
})
