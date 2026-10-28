/**
 * Where a reply's time went, one model round at a time: reading what's new, thinking, writing, and the tools in
 * between. rest: the gaps, mostly writing the tool call itself.
 */
export type Round = { read: number; readMs: number; think: number; thinkMs: number; write: number; writeMs: number; restMs: number; tools: string[]; toolMs: number }
export type Timing = { ms: number; rounds: Round[] }

/** meter: input tokens actually read so far (a start that matches what was read last time isn't read again) */
export function replyTiming(meter: () => { usedInputTokens: number }, now = () => performance.now()) {
  const t0 = now()
  const rounds: Round[] = []
  let r!: Round
  let start = 0, input = 0, last: number | undefined, toolStart = 0, pending = 0
  const begin = () => {
    r = { read: 0, readMs: 0, think: 0, thinkMs: 0, write: 0, writeMs: 0, restMs: 0, tools: [], toolMs: 0 }
    rounds.push(r)
    start = now(); input = meter().usedInputTokens; last = undefined
  }
  /** the gap since the last thing that happened, not yet counted as thinking or writing */
  const close = (t: number) => { r.restMs += t - (last ?? start) }
  begin()
  return {
    /** any token the model wrote: the first one ends the reading */
    token() {
      if (last !== undefined) return
      last = now()
      r.readMs = last - start
      r.read = meter().usedInputTokens - input
    },
    chunk(kind: 'think' | 'write', tokens: number) {
      const t = now()
      r[`${kind}Ms`] += t - (last ?? start)
      r[kind] += tokens
      last = t
    },
    tool(name: string) {
      if (pending++ === 0) { toolStart = now(); close(toolStart) }
      r.tools.push(name)
    },
    toolDone() {
      if (--pending > 0) return
      r.toolMs = now() - toolStart
      begin()
    },
    end(): Timing {
      const t = now()
      close(t)
      return { ms: t - t0, rounds }
    },
  }
}

const s = (ms: number) => `${(ms / 1000).toFixed(1)} s`
const n = (tokens: number) => tokens.toLocaleString('en-US')

/** one line for the log */
export function describeTiming({ ms, rounds }: Timing): string {
  const round = (r: Round) => [
    `read ${n(r.read)} tok ${s(r.readMs)}`,
    r.think ? `think ${n(r.think)} tok ${s(r.thinkMs)}` : '',
    r.write ? `write ${n(r.write)} tok ${s(r.writeMs)}` : '',
    r.restMs ? `rest ${s(r.restMs)}` : '',
    r.tools.length ? `${r.tools.join('+')} ${s(r.toolMs)}` : '',
  ].filter(Boolean).join(', ')
  return [`${s(ms)}, ${rounds.length} round${rounds.length === 1 ? '' : 's'}`, ...rounds.map(round)].join(' | ')
}
