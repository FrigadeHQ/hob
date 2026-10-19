import { expect, it } from 'vitest'
import { FakeEngine } from '../src/main/fake'

it('runs a scripted tool sequence through onTool and replies with the last result', async () => {
  const e = new FakeEngine()
  const calls: unknown[] = []
  const reply = await e.chat(
    { messages: [{ role: 'user', content: '__tools__ [["read_file",{"path":"a.csv"}],["list_files",{}]]\n\n[Attached: a.csv]' }], tools: [], thoughtBudget: 1024 },
    { onToken: () => {}, onTool: async (name, args) => { calls.push([name, args]); return `${name} ok` } },
  )
  expect(calls).toEqual([['read_file', { path: 'a.csv' }], ['list_files', {}]])
  expect(reply).toBe('Done. list_files ok')
  expect(e.lastRequest?.thoughtBudget).toBe(1024)
})
