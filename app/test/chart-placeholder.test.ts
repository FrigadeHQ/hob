import { expect, it } from 'vitest'
import { splitAtCharts } from '../src/shared/markdown'

it('cuts the reply where a model wrote a placeholder for its chart, so the chart shows there', () => {
  const t = 'Here is the comparison:\n\n[Chart: Total Revenue by Region]\n\n**Key takeaways:**\n1. North leads.'
  expect(splitAtCharts(t)).toEqual(['Here is the comparison:', '**Key takeaways:**\n1. North leads.'])
  expect(splitAtCharts('A\n\n[Bar chart showing sales]\n\nB')).toEqual(['A', 'B'])
  expect(splitAtCharts('A\n\n![chart](sales.chart.json)\n\nB')).toEqual(['A', 'B'])
})
it('knows the curly placeholders Gemma writes', () => {
  expect(splitAtCharts('**Total Monthly Revenue (Q3)**\n\n{chart}\n\n### Key Insights')).toEqual(['**Total Monthly Revenue (Q3)**', '### Key Insights'])
  expect(splitAtCharts('A\n{{chart}}\nB\n\n{graph: sales}\nC')).toEqual(['A', 'B', 'C'])
})
it('no placeholder: one piece; ordinary brackets and links stay', () => {
  expect(splitAtCharts('See [the report](https://x.com) and [note: draft].')).toEqual(['See [the report](https://x.com) and [note: draft].'])
  expect(splitAtCharts('Use {name} in the template.')).toEqual(['Use {name} in the template.'])
})
it('a placeholder at the very start or end leaves an empty piece, so the chart still goes there', () => {
  expect(splitAtCharts('[Chart: sales]\n\nNorth leads.')).toEqual(['', 'North leads.'])
  expect(splitAtCharts('North leads.\n\n{chart}')).toEqual(['North leads.', ''])
})
