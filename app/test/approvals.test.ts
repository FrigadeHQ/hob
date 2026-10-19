import { expect, it } from 'vitest'
import { Approvals } from '../src/main/agent/approvals'

it('resolves with the answer; aborting or an already-stopped turn means deny', async () => {
  const sent: string[] = []
  const a = new Approvals((req) => sent.push(req.id))
  const p = a.wait({ id: '1', requestId: 'r', text: 'ok?' }, new AbortController().signal)
  a.answer('1', 'always')
  expect(await p).toBe('always')

  const ac = new AbortController(); ac.abort()
  expect(await a.wait({ id: '2', requestId: 'r', text: 'ok?' }, ac.signal)).toBe('deny')
  expect(sent).toEqual(['1']) // never shown once stopped

  const ac2 = new AbortController()
  const q = a.wait({ id: '3', requestId: 'r', text: 'ok?' }, ac2.signal)
  ac2.abort()
  expect(await q).toBe('deny')
  a.answer('4', 'banana' as never) // unknown ids and junk answers are ignored
})

it('anything but allow/always counts as deny', async () => {
  const a = new Approvals(() => {})
  const p = a.wait({ id: '1', requestId: 'r', text: 'ok?' }, new AbortController().signal)
  a.answer('1', 'yes please' as never)
  expect(await p).toBe('deny')
})
