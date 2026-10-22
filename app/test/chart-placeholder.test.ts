import { expect, it } from 'vitest'
import { withoutChartPlaceholders } from '../src/shared/markdown'

it('drops the placeholder lines a model writes where its chart goes; the chart is shown by Garth', () => {
  const t = 'Here is the comparison:\n\n[Chart: Total Revenue by Region]\n\n**Key takeaways:**\n1. North leads.'
  expect(withoutChartPlaceholders(t)).toBe('Here is the comparison:\n\n**Key takeaways:**\n1. North leads.')
  expect(withoutChartPlaceholders('A\n\n[Bar chart showing sales]\n\nB')).toBe('A\n\nB')
  expect(withoutChartPlaceholders('A\n\n![chart](sales.chart.json)\n\nB')).toBe('A\n\nB')
})
it('keeps ordinary brackets and links', () => {
  const t = 'See [the report](https://x.com) and [note: draft].\n[Chart data is in data.csv]'
  expect(withoutChartPlaceholders('See [the report](https://x.com) and [note: draft].')).toBe('See [the report](https://x.com) and [note: draft].')
  expect(withoutChartPlaceholders(t)).toContain('[note: draft]')
})
