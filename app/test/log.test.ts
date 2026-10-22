import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { logLine, writeLog } from '../src/main/log'

it('a log line has the time, the level and the error with its stack', () => {
  const line = logLine('error', ['web search failed', new Error('connect ECONNREFUSED')], new Date('2026-10-22T20:00:00Z'))
  expect(line).toMatch(/^2026-10-22T20:00:00.000Z error web search failed Error: connect ECONNREFUSED\n\s+at /)
})

it('the log file never grows past its cap: the older half goes', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'hob-log-')), 'main.log')
  writeFileSync(file, 'x'.repeat(900))
  writeLog(file, 'y'.repeat(200) + '\n', 1000)
  expect(statSync(file).size).toBeLessThanOrEqual(1000)
  expect(readFileSync(file, 'utf8').endsWith('y'.repeat(200) + '\n')).toBe(true)
})
