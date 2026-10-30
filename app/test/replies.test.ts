import { expect, it } from 'vitest'
import { tidyTitle } from '../src/shared/replies'

it('tidies a name the person typed: one line, trimmed, nothing if blank', () => {
  expect(tidyTitle('  Sales\nsummary  ')).toBe('Sales summary')
  expect(tidyTitle('\t\n ')).toBe('')
  expect(tidyTitle('Trip notes')).toBe('Trip notes')
})

it('caps a long name so the sidebar stays readable', () => {
  expect(tidyTitle('A'.repeat(90))).toBe(`${'A'.repeat(79)}…`)
})
