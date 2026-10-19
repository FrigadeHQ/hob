import { expect, it } from 'vitest'
import { thinkingPreview } from '../src/shared/thinking'

it('shows the last complete sentence while the next one is still short', () => {
  expect(thinkingPreview('The user wants a chart. I should load the CSV with pandas. Then gro')).toBe('I should load the CSV with pandas.')
})
it('shows the sentence in progress once it is long enough to read', () => {
  expect(thinkingPreview('Okay. Now I need to group the rows by region and sum units times price for each')).toBe('Now I need to group the rows by region and sum units times price for each')
})
it('long text is cut at a word boundary from the end', () => {
  const t = thinkingPreview('word '.repeat(60).trim(), 40)
  expect(t.startsWith('…')).toBe(true)
  expect(t.length).toBeLessThanOrEqual(41)
  expect(t).not.toMatch(/…\S*wor$/)
})
it('empty in, empty out', () => { expect(thinkingPreview('  ')).toBe('') })
