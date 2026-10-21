import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { parseCsv, validateChart } from '../src/shared/chart'
import { makeChart } from '../src/main/tools/chart'
import type { TurnCtx } from '../src/main/agent/tool'

const rows = [{ month: 'Jan', sales: 10, costs: '4' }, { month: 'Feb', sales: 30, costs: 8 }]

it('a good chart: numbers as text become numbers; series can be plain keys', () => {
  const r = validateChart({ type: 'bar', title: 'Sales', x: 'month', series: ['sales', { key: 'costs', label: 'Costs' }], data: rows })
  expect(r).toEqual({ spec: { version: 1, type: 'bar', title: 'Sales', x: 'month', series: [{ key: 'sales', label: 'sales' }, { key: 'costs', label: 'Costs' }], data: [{ month: 'Jan', sales: 10, costs: 4 }, { month: 'Feb', sales: 30, costs: 8 }] } })
})

it('says plainly what is wrong, so the model can fix it', () => {
  expect(validateChart({ type: 'radar', x: 'month', series: ['sales'], data: rows })).toEqual({ error: expect.stringContaining('type must be one of bar, line, area, pie, scatter') })
  expect(validateChart({ type: 'bar', x: 'month', series: ['sales'], data: [] })).toEqual({ error: expect.stringContaining('no data') })
  expect(validateChart({ type: 'bar', x: 'week', series: ['sales'], data: rows })).toEqual({ error: expect.stringContaining('"week"') })
  expect(validateChart({ type: 'bar', x: 'month', series: ['profit'], data: rows })).toEqual({ error: expect.stringContaining('"profit"') })
  expect(validateChart({ type: 'bar', x: 'month', series: ['month'], data: rows })).toEqual({ error: expect.stringContaining('numbers') })
  expect(validateChart({ type: 'pie', x: 'month', series: ['sales', 'costs'], data: rows })).toEqual({ error: expect.stringContaining('one series') })
  expect(validateChart({ type: 'bar', x: 'month', series: Array.from({ length: 9 }, (_, i) => `s${i}`), data: rows })).toEqual({ error: expect.stringContaining('at most 8') })
  expect(validateChart({ type: 'bar', x: 'i', series: ['v'], data: Array.from({ length: 2001 }, (_, i) => ({ i, v: i })) })).toEqual({ error: expect.stringContaining('2000') })
})

it('reads simple CSV, quotes and all', () => {
  expect(parseCsv('month,sales\nJan,10\n"Feb, late",30\n')).toEqual([{ month: 'Jan', sales: '10' }, { month: 'Feb, late', sales: '30' }])
})

function ctx(): TurnCtx {
  const chatDir = mkdtempSync(join(tmpdir(), 'mabel-chart-'))
  return { chatDir, grants: [], signal: new AbortController().signal, untrusted: false, webAccess: false, journal: undefined as never, trash: async () => {}, python: undefined, runTmp: chatDir, fetch } as TurnCtx
}

it('make_chart saves the chart in the chat folder; data can come from a CSV code saved', async () => {
  const c = ctx()
  const out = await makeChart.run({ type: 'line', title: 'Sales by month', x: 'month', series: ['sales'], data: rows }, c)
  expect(out.files).toEqual([join(c.chatDir, 'Sales by month.chart.json')])
  expect(JSON.parse(readFileSync(out.files![0], 'utf8'))).toMatchObject({ version: 1, type: 'line' })
  expect(makeChart.action({ type: 'line', title: 'Sales by month', x: 'month', series: ['sales'], data: rows }, c)).toEqual({ kind: 'create', paths: [join(c.chatDir, 'Sales by month.chart.json')] })

  writeFileSync(join(c.chatDir, 'totals.csv'), 'region,total\nNorth,10\nSouth,30\n')
  const args = makeChart.prepare!({ type: 'pie', title: 'By region', x: 'region', series: ['total'], file: 'totals.csv' } as never, c)
  const pie = await makeChart.run(args, c)
  expect(pie.failed).toBeFalsy()
  expect(JSON.parse(readFileSync(pie.files![0], 'utf8')).data).toEqual([{ region: 'North', total: 10 }, { region: 'South', total: 30 }])

  const bad = await makeChart.run({ type: 'bar', title: 'x', x: 'nope', series: ['sales'], data: rows }, c)
  expect(bad).toMatchObject({ failed: true })
  // only files in the chat folder
  mkdirSync(join(c.chatDir, '..', 'elsewhere'), { recursive: true })
  const outside = makeChart.prepare!({ type: 'bar', title: 'x', x: 'a', series: ['b'], file: join(c.chatDir, '..', 'elsewhere', 'x.csv') } as never, c)
  expect((await makeChart.run(outside, c)).text).toContain("isn't in this chat's folder")
})

it('rows with dates along the bottom are put in date order; other rows keep their order', () => {
  const sorted = (data: Record<string, unknown>[], type = 'line') => {
    const r = validateChart({ type, x: 'd', series: ['v'], data })
    return 'spec' in r ? r.spec.data.map((row) => row.d) : r.error
  }
  expect(sorted([{ d: '5/18/2026', v: 1 }, { d: '5/6/2026', v: 2 }, { d: '4/29/2026', v: 3 }])).toEqual(['4/29/2026', '5/6/2026', '5/18/2026'])
  expect(sorted([{ d: '2026-03-02', v: 1 }, { d: '2026-02-27', v: 2 }], 'bar')).toEqual(['2026-02-27', '2026-03-02'])
  // names, months and a mix stay as the model gave them
  expect(sorted([{ d: 'Mar', v: 1 }, { d: 'Jan', v: 2 }])).toEqual(['Mar', 'Jan'])
  expect(sorted([{ d: 'North', v: 1 }, { d: '2026-01-01', v: 2 }])).toEqual(['North', '2026-01-01'])
  // a pie's slices aren't a timeline
  expect(sorted([{ d: '2026-03-02', v: 1 }, { d: '2026-02-27', v: 2 }], 'pie')).toEqual(['2026-03-02', '2026-02-27'])
})
