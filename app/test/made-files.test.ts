import { expect, it } from 'vitest'
import type { Step } from '../src/shared/agent'
import { madeFiles } from '../src/shared/madeFiles'

const ran = (files: string[]): Step => ({ id: 'r', title: 'Ran code', status: 'done', tool: 'run_python', files })
const chart = (file: string): Step => ({ id: 'c', title: 'Made a chart', status: 'done', tool: 'make_chart', files: [file] })

it("data files the code saved along the way get no card unless the reply names them", () => {
  const steps = [ran(['/c/revenue_by_product.csv', '/c/revenue_by_region.csv', '/c/summary.pdf']), chart('/c/Revenue by Region.chart.json')]
  expect(madeFiles(steps, "I've created three charts based on the Q3 sales data.")).toEqual(['/c/summary.pdf', '/c/Revenue by Region.chart.json'])
  expect(madeFiles(steps, 'The totals are in revenue_by_region.csv.')).toEqual(['/c/revenue_by_region.csv', '/c/summary.pdf', '/c/Revenue by Region.chart.json'])
})

it('files the user is likely to want still show: spreadsheets, documents, pictures, and data written on purpose', () => {
  expect(madeFiles([ran(['/c/clean.xlsx', '/c/chart.png', '/c/report.docx'])], 'Done.')).toEqual(['/c/clean.xlsx', '/c/chart.png', '/c/report.docx'])
  const written: Step = { id: 'w', title: 'Wrote totals.csv', status: 'done', tool: 'write_file', files: ['/c/totals.csv'] }
  expect(madeFiles([written], 'Done.')).toEqual(['/c/totals.csv'])
})

it("a chart's data file and a failed step's files never get a card", () => {
  const steps: Step[] = [{ ...chart('/c/sales.chart.json'), uses: ['/c/totals.csv'] }, { ...ran(['/c/x.csv']), status: 'error' }]
  expect(madeFiles(steps, 'see totals.csv')).toEqual(['/c/sales.chart.json'])
})
