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

it('every idea fits on one line of its card', async () => {
  const { allStarterTitles } = await import('../src/renderer/src/starters')
  const long = allStarterTitles().filter((t) => t.length > 32)
  expect(long).toEqual([])
})

it('"Connect my email and calendar" is one of the four until it is done', () => {
  for (let seed = 0; seed < 6; seed++) {
    const shown = pickStarters([], seed, { connect: true })
    expect(shown).toHaveLength(4)
    expect(shown[1]).toMatchObject({ title: 'Connect my email and calendar', connect: true })
    expect(pickStarters([], seed).some((s) => s.connect)).toBe(false)
  }
})
