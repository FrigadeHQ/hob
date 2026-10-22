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
})

it('hides what went wrong along the way when the task still got done; shows it when nothing worked', () => {
  const failed: Step = { id: '1', title: "Couldn't find top-stories", status: 'error', tool: 'read_file' }
  const worked: Step = { id: '2', title: 'Read orangebot.ai', status: 'done', tool: 'fetch_url' }
  expect(stepRows([failed, worked], false).map((r) => r.title)).toEqual(['Read orangebot.ai'])
  expect(stepRows([failed, worked], true).map((r) => r.title)).toEqual(['Read orangebot.ai'])
  expect(stepRows([failed], false).map((r) => r.status)).toEqual(['error'])
  // a step the user said no to is their decision, not a hiccup: it stays
  expect(stepRows([{ ...failed, status: 'denied' }, worked], false)).toHaveLength(2)
})

it('different steps stay apart', () => {
  expect(stepRows([s('1', 'Ran code', 'done'), { id: '2', title: 'Read a.csv', status: 'done' }, s('3', 'Ran code', 'done')], false)).toHaveLength(3)
  expect(stepRows([s('1', 'Ran make.py', 'done'), s('2', 'Ran code', 'done')], false)).toHaveLength(2)
})

it('while the reply is still running, steps that failed are left out: whether it fails overall is not known yet', () => {
  const failed: Step = { id: '1', title: "Couldn't read data.csv", status: 'error', tool: 'read_file' }
  const next: Step = { id: '2', title: 'Ran code', status: 'running', tool: 'run_python' }
  expect(stepRows([failed, next], true).map((r) => r.title)).toEqual(['Ran code'])
})
