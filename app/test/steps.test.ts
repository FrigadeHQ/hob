import { expect, it } from 'vitest'
import { stepRows } from '../src/shared/steps'
import type { Step } from '../src/shared/agent'

const s = (id: string, title: string, status: Step['status'], detail?: string): Step => ({ id, title, status, tool: 'run_python', ...(detail ? { detail } : {}) })

it('retries of the same step become one row with the outcome of the last try', () => {
  const rows = stepRows([s('1', 'Ran code', 'error', 'a'), s('2', 'Ran code', 'error', 'b'), s('3', 'Ran code', 'done', 'c'), { id: '4', title: 'Made a chart', status: 'done' }], false)
  expect(rows.map((r) => [r.title, r.status, r.tries])).toEqual([['Ran code', 'done', 3], ['Made a chart', 'done', 1]])
  expect(rows[0].detail).toContain('Try 1')
  expect(rows[0].detail).toContain('c')
})

it("a failed try that's still being worked on isn't shown as an error; once the reply is done it is", () => {
  const steps = [s('1', 'Ran code', 'error'), s('2', 'Ran code', 'error')]
  expect(stepRows(steps, true)[0].status).toBe('retrying')
  expect(stepRows(steps, false)[0].status).toBe('error')
  // gave up and moved on: the failure stays visible
  expect(stepRows([...steps, { id: '3', title: 'Searched the web', status: 'done' }], true)[0].status).toBe('error')
})

it('different steps stay apart', () => {
  expect(stepRows([s('1', 'Ran code', 'done'), { id: '2', title: 'Read a.csv', status: 'done' }, s('3', 'Ran code', 'done')], false)).toHaveLength(3)
  expect(stepRows([s('1', 'Ran make.py', 'done'), s('2', 'Ran code', 'done')], false)).toHaveLength(2)
})
