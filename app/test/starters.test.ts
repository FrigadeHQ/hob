import { expect, it } from 'vitest'
import { pickStarters } from '../src/renderer/src/starters'

it('the chart idea is always on the home screen; the rest rotate', () => {
  for (let seed = 0; seed < 12; seed++) {
    const shown = pickStarters([], seed)
    expect(shown).toHaveLength(4)
    expect(shown[0].title).toBe('Turn a spreadsheet into a chart')
    expect(new Set(shown.map((s) => s.title)).size).toBe(4)
  }
  expect(new Set(Array.from({ length: 12 }, (_, s) => pickStarters([], s)[1].title)).size).toBeGreaterThan(1)
})
