import { describe, expect, it } from 'vitest'
import { describeTiming, replyTiming } from '../src/engine/timing'

/** a clock and a token meter the test moves by hand */
function fake() {
  const s = { t: 0, input: 1000 }
  return { s, now: () => s.t, meter: () => ({ usedInputTokens: s.input, usedOutputTokens: 0 }) }
}

describe('replyTiming', () => {
  it('splits a reply into reading, thinking, writing and the tools between', () => {
    const { s, now, meter } = fake()
    const t = replyTiming(meter, now)
    // round 1: reads 3,000 tokens, thinks, calls a tool
    s.t = 2000; s.input += 3000; t.token()
    s.t = 3000; t.chunk('think', 40)
    s.t = 3500; t.tool('list_files')
    s.t = 3600; t.toolDone()
    // round 2: reads the result, writes the answer
    s.t = 3900; s.input += 200; t.token()
    s.t = 4900; t.chunk('write', 30)
    s.t = 5000
    const r = t.end()
    expect(r.ms).toBe(5000)
    expect(r.rounds).toEqual([
      { read: 3000, readMs: 2000, think: 40, thinkMs: 1000, write: 0, writeMs: 0, restMs: 500, tools: ['list_files'], toolMs: 100 },
      { read: 200, readMs: 300, think: 0, thinkMs: 0, write: 30, writeMs: 1000, restMs: 100, tools: [], toolMs: 0 },
    ])
    expect(describeTiming(r)).toBe('5.0 s, 2 rounds | read 3,000 tok 2.0 s, think 40 tok 1.0 s, rest 0.5 s, list_files 0.1 s | read 200 tok 0.3 s, write 30 tok 1.0 s, rest 0.1 s')
  })

  it('waits for every tool the model called at once before the next round starts', () => {
    const { s, now, meter } = fake()
    const t = replyTiming(meter, now)
    s.t = 100; t.token()
    t.tool('read_file'); t.tool('read_file')
    s.t = 300; t.toolDone()
    s.t = 500; t.toolDone()
    s.t = 600; t.token()
    expect(t.end().rounds.map((r) => [r.tools.length, r.toolMs, r.readMs])).toEqual([[2, 400, 100], [0, 0, 100]])
  })
})
