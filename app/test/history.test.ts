import { expect, it } from 'vitest'
import { fitHistory, ToolBudget } from '../src/main/agent/history'

const msg = (role: 'user' | 'assistant', content: string) => ({ role, content })

it('keeps short chats as they are', () => {
  const h = [msg('user', 'hi'), msg('assistant', 'hello')]
  expect(fitHistory(h, 1000)).toEqual(h)
})

it('folds the oldest turns into a short recap and keeps the newest whole', () => {
  const h = [
    msg('user', 'Make a chart of sales.csv please'), msg('assistant', 'x'.repeat(500)),
    msg('user', 'Now a summary table'), msg('assistant', 'y'.repeat(500)),
    msg('user', 'And email text'), msg('assistant', 'Here is the email.'),
  ]
  const out = fitHistory(h, 700)
  expect(out.at(-1)).toEqual(msg('assistant', 'Here is the email.'))
  expect(out.at(-2)).toEqual(msg('user', 'And email text'))
  expect(out[0].role).toBe('user')
  expect(out[0].content).toMatch(/^\[Earlier in this chat, shortened to save memory\]/)
  expect(out[0].content).toContain('- The user asked: Make a chart of sales.csv please')
  // the recap is a user turn followed by an assistant turn, so roles still alternate
  expect(out[1].role).toBe('assistant')
  expect(out.map((m) => m.content).join('').length).toBeLessThan(1400)
})

it('never drops the latest exchange, even when it alone is over budget', () => {
  const h = [msg('user', 'a'.repeat(2000)), msg('assistant', 'b'.repeat(2000))]
  expect(fitHistory(h, 100).slice(-2)).toEqual(h)
})

it('tool results get shorter once a task has read a lot', () => {
  const b = new ToolBudget(1000, 200)
  expect(b.take('x'.repeat(600))).toHaveLength(600)
  const cut = b.take('y'.repeat(600))
  expect(cut.length).toBeLessThan(600)
  expect(cut).toContain('shortened')
})

it('folding keeps user/assistant alternation when a reply is missing', () => {
  const h = [msg('user', 'a'.repeat(300)), msg('assistant', 'b'.repeat(300)), msg('user', 'orphan ' + 'c'.repeat(300)), msg('user', 'd'.repeat(300)), msg('assistant', 'e')]
  const out = fitHistory(h, 700)
  for (let i = 1; i < out.length; i++) if (out[i].role === 'assistant') expect(out[i - 1].role).toBe('user')
  expect(out.at(-1)!.content).toBe('e')
})

it('what was in an attached file stays when its turn is folded into the recap, so a long chat about a menu still knows the menu', () => {
  const h = [
    { role: 'user' as const, content: 'What goes with steak?', files: '[What\'s in wine-menu.pdf, read by Hob:\nBarolo 2019, $84]' }, msg('assistant', 'x'.repeat(500)),
    msg('user', 'Something cheaper?'), msg('assistant', 'y'.repeat(500)),
    msg('user', 'And a white?'), msg('assistant', 'The Sancerre.'),
  ]
  const out = fitHistory(h, 700)
  expect(out[0].content).toContain('Barolo 2019, $84')
  expect(out.at(-1)).toEqual(msg('assistant', 'The Sancerre.'))
  // kept turns carry their files in their own text
  expect(fitHistory(h, 100_000)[0].content).toBe('What goes with steak?\n[What\'s in wine-menu.pdf, read by Hob:\nBarolo 2019, $84]')
})
