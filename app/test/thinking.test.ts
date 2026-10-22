import { expect, it } from 'vitest'
import { thinkingPreview } from '../src/shared/thinking'

it('shows the last complete sentence while the next one is still short', () => {
  expect(thinkingPreview('The user wants a chart. I should load the CSV with pandas. Then gro')).toBe('I should load the CSV with pandas.')
})
it('shows the sentence in progress once it is long enough to read', () => {
  expect(thinkingPreview('Okay. Now I need to group the rows by region and sum units times price for each')).toBe('Now I need to group the rows by region and sum units times price for each')
})
it('a long sentence is cut at the end, at a word boundary, with …', () => {
  const t = thinkingPreview('I will now go through every single one of these files and put each into the folder that fits its type best', 60)
  expect(t.startsWith('I will now go through')).toBe(true)
  expect(t.endsWith('…')).toBe(true)
  expect(t.length).toBeLessThanOrEqual(61)
  expect(t).not.toMatch(/\s…$/)
})
it('plain text: no markdown marks', () => {
  expect(thinkingPreview('I will use `pandas` and **group** the rows by [region](x).')).toBe('I will use pandas and group the rows by region.')
})
it('skips lists and mappings, which read as noise on one line', () => {
  const t = 'Plan the folders by file type.\n`xlsx` -> `Spreadsheets`\n`pdf` -> `PDFs`\n`docx`, `doc`, `rtf`, `txt` -> `Documents`\n'
  expect(thinkingPreview(t)).toBe('Plan the folders by file type.')
  expect(thinkingPreview('- images\n- audio\nThen I move them.')).toBe('Then I move them.')
})
it('a heading that introduces a list is skipped for the sentence before it', () => {
  expect(thinkingPreview('I should check what is in the folder first. File list from prompt:')).toBe('I should check what is in the folder first.')
})
it('model control tags never show', () => {
  expect(thinkingPreview('I will list the files now.<channel|><|tool_call>call:list_files{')).toBe('I will list the files now.')
})
it('empty in, empty out', () => { expect(thinkingPreview('  ')).toBe('') })
