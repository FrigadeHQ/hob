import { getLlama, InsufficientMemoryError, LlamaChatSession, type ChatSessionModelFunctions, type Llama, type LlamaContext, type LlamaModel, type ChatHistoryItem } from 'node-llama-cpp'
import { finalAnswer } from './answer'
import { serial } from './serial'
import { toolFunctions } from './tools'
import type { ToolSpec } from '../shared/agent'
import type { EngineEvent, EngineRequest, GpuProbe } from '../shared/engine-protocol'
import type { ChatMessage } from '../shared/types'

const GB = 1e9
// Unbounded "thinking" made a simple question take ~25 s before the first visible word
// (Qwen3.6 35B on M1 Max). A small budget keeps answers prompt; Plan 2 can raise it for agent tasks.
export const CHAT_THOUGHT_BUDGET = 256
// Agent turns carry tool output. The picker's size is a safe floor; grow to 32k when memory allows.
export const AGENT_CONTEXT = 32768
/**
 * Qwen's recommended sampling for thinking mode. Greedy decoding (the default) made long agent
 * turns fall into word-for-word loops; a little randomness plus a presence penalty avoids that.
 */
export const SAMPLING = {
  temperature: 0.6, topP: 0.95, topK: 20, minP: 0,
  repeatPenalty: { lastTokens: 256, penalty: 1.05, presencePenalty: 0.5 },
} as const
let llama: Llama | undefined
let model: LlamaModel | undefined
let context: LlamaContext | undefined
const aborts = new Map<number, AbortController>()
// load/unload/chat must never overlap: a load disposes the context a chat is using.
const run = serial()

const send = (e: EngineEvent) => process.parentPort.postMessage(e)

/** tool calls waiting for the main process to answer */
const toolWaits = new Map<number, (result: string) => void>()
let nextCallId = 1

function callMain(id: number, name: string, args: unknown, signal: AbortSignal): Promise<string> {
  // an abort listener added after Stop would never fire and the chat would hang the queue
  if (signal.aborted) return Promise.resolve('Stopped by the user.')
  const callId = nextCallId++
  return new Promise((resolve) => {
    toolWaits.set(callId, resolve)
    signal.addEventListener('abort', () => { toolWaits.delete(callId); resolve('Stopped by the user.') }, { once: true })
    send({ id, type: 'tool-call', callId, name, args })
  })
}
const getL = async () => (llama ??= await getLlama())

async function probe(): Promise<GpuProbe> {
  const l = await getL()
  const v = await l.getVramState()
  return { gpuType: l.gpu, vramTotalGB: v.total / GB, unifiedGB: v.unifiedSize / GB, gpuNames: await l.getGpuDeviceNames() }
}

async function unload() {
  await context?.dispose(); context = undefined
  await model?.dispose(); model = undefined
}

async function load(modelPath: string, contextSize: number) {
  await unload()
  const l = await getL()
  model = await l.loadModel({ modelPath })
  context = await model.createContext({ contextSize: { min: contextSize, max: Math.max(contextSize, AGENT_CONTEXT) } })
  // The first evaluation pages the weights in from disk (~8 s for a 21 GB model).
  // Pay that here, while setup shows progress, not on the user's first message.
  const warm = context.getSequence()
  try { await warm.evaluateWithoutGeneratingNewTokens(model.tokenize('Hello')) } finally { warm.dispose() }
}

function toHistory(messages: ChatMessage[]): ChatHistoryItem[] {
  return messages.map((m) =>
    m.role === 'system' ? { type: 'system', text: m.content }
    : m.role === 'user' ? { type: 'user', text: m.content }
    : { type: 'model', response: [m.content] })
}

/** the previous reply's sequence can take a moment to be released after it finished */
async function freeSequence(ctx: LlamaContext) {
  for (let i = 0; ctx.sequencesLeft === 0 && i < 100; i++) await new Promise((r) => setTimeout(r, 50))
  return ctx.getSequence()
}

async function chat(id: number, messages: ChatMessage[], tools: ToolSpec[], thoughtBudget: number, maxTokens?: number) {
  if (!context) throw new Error('No model loaded')
  const last = messages.at(-1)
  if (!last || last.role !== 'user') throw new Error('Last message must be from the user')
  const sequence = await freeSequence(context)
  const session = new LlamaChatSession({ contextSequence: sequence })
  session.setChatHistory(toHistory(messages.slice(0, -1)))
  const ac = new AbortController()
  aborts.set(id, ac)
  let thought = ''
  try {
    const response = await session.prompt(last.content, {
      ...SAMPLING,
      signal: ac.signal, stopOnAbortSignal: true, budgets: { thoughtTokens: thoughtBudget }, ...(maxTokens ? { maxTokens } : {}),
      functions: tools.length ? (toolFunctions(tools, (name, args) => callMain(id, name, args, ac.signal)) as unknown as ChatSessionModelFunctions) : undefined,
      onTextChunk: (text) => send({ id, type: 'token', text }),
      onResponseChunk: (c) => {
        if (c.type === 'segment' && c.segmentType === 'thought') { thought += c.text; send({ id, type: 'token', text: c.text, thought: true }) }
      },
    })
    return finalAnswer(response, thought)
  } finally {
    aborts.delete(id)
    session.dispose()
    sequence.dispose()
  }
}

async function handle(req: EngineRequest): Promise<unknown> {
  if (req.type === 'probe') return probe()
  if (req.type === 'load') return load(req.modelPath, req.contextSize)
  if (req.type === 'chat') return chat(req.id, req.messages, req.tools ?? [], req.thoughtBudget ?? CHAT_THOUGHT_BUDGET, req.maxTokens)
  if (req.type === 'unload') return unload()
}

process.parentPort.on('message', async ({ data }: { data: EngineRequest }) => {
  const req = data
  if (req.type === 'tool-result') { toolWaits.get(req.callId)?.(req.result); toolWaits.delete(req.callId); return }
  try {
    const result = req.type === 'abort' ? aborts.get(req.targetId)?.abort() : await run(() => handle(req))
    send({ id: req.id, type: 'result', data: result ?? null })
  } catch (err) {
    const oom = err instanceof InsufficientMemoryError
    send({ id: req.id, type: 'error', message: err instanceof Error ? err.message : String(err), code: oom ? 'OOM' : undefined })
  }
})
