import { expect, it } from 'vitest'
import { LiveTurns } from '../src/main/agent/live'

it('keeps what a running reply has done so far, so its chat can pick it up again', () => {
  const changes: unknown[] = []
  const live = new LiveTurns((list) => changes.push(list))
  live.start('c1', 'r1')
  live.token('r1', 'Hel'); live.token('r1', 'lo'); live.token('r1', 'hmm', true)
  live.step('r1', { id: 's1', title: 'Ran code', status: 'running' })
  live.step('r1', { id: 's1', title: 'Ran code', status: 'done' })
  expect(live.get('c1')).toMatchObject({ requestId: 'r1', content: 'Hello', steps: [{ id: 's1', status: 'done' }] })
  live.reset('r1')
  expect(live.get('c1')?.content).toBe('')
  live.approval({ id: 'a1', requestId: 'r1', text: 'Allow?' })
  expect(live.get('c1')?.approval?.id).toBe('a1')
  expect(live.list()).toEqual([{ chatId: 'c1', waiting: true }])
  live.answered('a1')
  expect(live.get('c1')?.approval).toBeUndefined()
  live.finish('r1')
  expect(live.get('c1')).toBeUndefined()
  expect(changes.at(-1)).toEqual([])
  // unknown requests are ignored
  live.token('nope', 'x')
})
