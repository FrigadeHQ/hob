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
