import { LlamaChat, type ChatHistoryItem, type ChatModelFunctions, type ChatModelResponse, type LLamaChatGenerateResponseOptions, type LlamaChatResponseChunk, type LlamaContextSequence, type Token } from 'node-llama-cpp'
import { CALL_END, CALL_START, HobGemmaChatWrapper, parseCall } from './gemma'

type Tool = { description: string; params: Record<string, unknown>; handler(args: unknown): Promise<string> }
type Sampling = Pick<LLamaChatGenerateResponseOptions<undefined>, 'temperature' | 'topP' | 'topK' | 'minP' | 'repeatPenalty'>

/**
 * A reply from Gemma 4 with tools, Gemma writing its calls its own way (see gemma.ts). Each round streams until
 * the model ends a call (`<tool_call|>`); Hob reads the call, runs the tool, and the model carries on in the same
 * turn. Returns the text of each round.
 */
export async function gemmaReply(o: {
  sequence: LlamaContextSequence
  /** the conversation, ending with the user's new message */
  history: ChatHistoryItem[]
  tools: Record<string, Tool>
  sampling: Sampling
  /** read again each round: it grows once a tool has been called */
  budgets: { thoughtTokens: number }
  maxTokens?: number
  signal: AbortSignal
  /** the reply's text, except the calls */
  onText(text: string): void
  /** thinking and text, as node-llama-cpp streams them */
  onChunk(chunk: LlamaChatResponseChunk): void
  onToken?(tokens: Token[]): void
}): Promise<string[]> {
  const wrapper = gemmaWrapper(o.tools)
  const model = o.sequence.model
  const callStart = model.tokenize(CALL_START, true)[0]
  const callEnd = model.tokenize(CALL_END, true)[0]
  const chat = new LlamaChat({ contextSequence: o.sequence, chatWrapper: wrapper, autoDisposeSequence: false })
  const reply: { type: 'model'; response: ChatModelResponse['response'] } = { type: 'model', response: [] }
  const texts: string[] = []
  let thoughts = 0
  try {
    for (;;) {
      const raw: Token[] = []
      let text = ''
      let inCall = false
      // the round ends when a call does. Not a stop trigger: node-llama-cpp checks those against the reply so far
      // too, and after the first call that already holds one, so the next round stopped before it began
      const called = new AbortController()
      // no lastEvaluationContextWindow: with it, the next round was built on the reply as first read (the call as
      // plain text, no result) and the model ended its turn at once
      const res = await chat.generateResponse([...o.history, reply], {
        ...o.sampling,
        signal: AbortSignal.any([o.signal, called.signal]), stopOnAbortSignal: true, maxTokens: o.maxTokens,
        budgets: { thoughtTokens: Math.max(0, o.budgets.thoughtTokens - thoughts) },
        onToken: (tokens) => {
          raw.push(...tokens)
          if (tokens.includes(callStart)) inCall = true
          if (inCall && tokens.includes(callEnd)) called.abort()
          o.onToken?.(tokens)
        },
        // the call itself is Hob's to read, not the user's
        onTextChunk: (chunk) => { if (!inCall) { text += chunk; o.onText(chunk) } },
        onResponseChunk: (c) => {
          if (c.type === 'segment' && c.segmentType === 'thought') thoughts += c.tokens.length
          o.onChunk(c)
        },
      })
      const said = model.detokenize(raw, true)
      const at = said.lastIndexOf(CALL_START)
      const call = called.signal.aborted && !o.signal.aborted && at !== -1
        ? parseCall(said.slice(at + CALL_START.length).replace(/^call:/, '').split(CALL_END)[0])
        : undefined
      texts.push(call ? text.split(CALL_START)[0] : text)
      if (!call || o.signal.aborted) return texts
      const tool = o.tools[call.name]
      const result = tool ? await tool.handler(call.args) : `There is no tool called ${call.name}. Use one of: ${Object.keys(o.tools).join(', ')}.`
      reply.response.push(
        ...res.fullResponse.filter((r) => typeof r !== 'string'),
        ...(texts.at(-1)?.trim() ? [texts.at(-1)!] : []),
        { type: 'functionCall', name: call.name, params: call.args, result },
      )
      if (o.signal.aborted) return texts
    }
  } finally {
    chat.dispose({ disposeSequence: false })
  }
}

/** the wrapper for these tools: reading ahead must use the same one, or the start is read again */
export function gemmaWrapper(tools: Record<string, { description: string; params: Record<string, unknown> }>) {
  const wrapper = new HobGemmaChatWrapper()
  wrapper.tools = Object.fromEntries(Object.entries(tools).map(([n, t]) => [n, { description: t.description, params: t.params }])) as unknown as ChatModelFunctions
  return wrapper
}
