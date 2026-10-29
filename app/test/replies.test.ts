import { expect, it } from 'vitest'
import { tidyTitle } from '../src/shared/replies'

it('tidies a title the person typed: one line, trimmed, nothing if blank', () => {
  expect(tidyTitle('  Sales\nsummary  ')).toBe('Sales summary')
  expect(tidyTitle('\t\n')).toBe('')
  expect(tidyTitle('   ')).toBe('')
  expect(tidyTitle('Trip notes')).toBe('Trip notes')
})

it('caps a long title so the sidebar stays readable', () => {
  const long = 'A'.repeat(90)
  expect(tidyTitle(long)).toBe(`${'A'.repeat(79)}…`)
  expect(tidyTitle(long).length).toBe(80)
})
