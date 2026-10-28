import { getLlama, InsufficientMemoryError, LlamaChatSession, resolveChatWrapper, type ChatSessionModelFunctions, type ChatWrapper, type Llama, type LlamaContext, type LlamaContextSequence, type LlamaModel, type ChatHistoryItem } from 'node-llama-cpp'
import { finalAnswer } from './answer'
import { cleanAnswer, streamCleaner } from './control'
import { samplingFor } from './sampling'
import { serial } from './serial'
import { describeTiming, replyTiming } from './timing'
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
let llama: Llama | undefined
let model: LlamaModel | undefined
let context: LlamaContext | undefined
/**
 * One sequence kept for the model's whole life: it remembers what it last read, and a new request that starts
 * the same way (same system prompt, tools and history) only reads what's new. 3.6 s → 0.35 s to the first word
 * for a follow-up on gpt-oss-20b (M1 Max), where a fresh sequence per message re-read ~3,000 tokens every time.
 */
let main: LlamaContextSequence | undefined
/** the small model for side jobs (naming chats), so they don't push the conversation out of `main` */
let side: { model: LlamaModel; context: LlamaContext; sequence: LlamaContextSequence } | undefined
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
// HOB_ENGINE_GPU=off: the graphics card crashed the engine before (src/main/engine.ts)
const getL = async () => (llama ??= await getLlama(process.env.HOB_ENGINE_GPU === 'off' ? { gpu: false } : undefined))

async function probe(): Promise<GpuProbe> {
  const l = await getL()
  const v = await l.getVramState()
  return { gpuType: l.gpu, vramTotalGB: v.total / GB, unifiedGB: v.unifiedSize / GB, gpuNames: await l.getGpuDeviceNames() }
}

async function unload() {
  main = undefined
  await context?.dispose(); context = undefined
  await model?.dispose(); model = undefined
  await unloadSide()
}

async function unloadSide() {
  const s = side
  side = undefined
  await s?.context.dispose(); await s?.model.dispose()
}

async function loadSide(modelPath: string, contextSize: number) {
  await unloadSide()
  const l = await getL()
  const m = await l.loadModel({ modelPath })
  const c = await m.createContext({ contextSize })
  side = { model: m, context: c, sequence: c.getSequence() }
}

async function load(modelPath: string, contextSize: number) {
  await unload()
  const l = await getL()
  model = await l.loadModel({ modelPath })
  context = await model.createContext({ contextSize: { min: contextSize, max: Math.max(contextSize, AGENT_CONTEXT) } })
  // The first evaluation pages the weights in from disk (~8 s for a 21 GB model).
  // Pay that here, while setup shows progress, not on the user's first message.
  main = context.getSequence()
  await main.evaluateWithoutGeneratingNewTokens(model.tokenize('Hello'))
}

function toHistory(messages: ChatMessage[]): ChatHistoryItem[] {
  return messages.map((m) =>
    m.role === 'system' ? { type: 'system', text: m.content }
    : m.role === 'user' ? { type: 'user', text: m.content }
    : { type: 'model', response: [m.content] })
}

async function chat(id: number, req: { messages: ChatMessage[]; tools: ToolSpec[]; thoughtBudget: number; thoughtBudgetWithTools?: number; maxTokens?: number; side?: boolean; reasoning?: 'low' | 'high' }) {
  const sequence = req.side && side ? side.sequence : main
  if (!sequence) throw new Error('No model loaded')
  const { messages, tools, maxTokens } = req
  const last = messages.at(-1)
  if (!last || last.role !== 'user') throw new Error('Last message must be from the user')
  const session = new LlamaChatSession({ contextSequence: sequence, chatWrapper: wrapperFor(req.side && side ? side.model : model, req.reasoning) })
  session.setChatHistory(toHistory(messages.slice(0, -1)))
  const ac = new AbortController()
  aborts.set(id, ac)
  let thought = ''
  const timing = replyTiming(() => sequence.tokenMeter.getState())
  // read again after every tool call: a quick question thinks briefly; once it turns into a task (a tool was
  // called, in whatever language it was asked) it gets the longer budget for the rest of the reply
  const budgets = { thoughtTokens: req.thoughtBudget }
  const onTool = (name: string, args: unknown) => {
    if (req.thoughtBudgetWithTools) budgets.thoughtTokens = Math.max(budgets.thoughtTokens, req.thoughtBudgetWithTools)
    timing.tool(name)
    return callMain(id, name, args, ac.signal).finally(() => timing.toolDone())
  }
  // a thought the model opened with a made-up tag streams as thinking, like a real one
  const clean = streamCleaner((text) => { thought += text; send({ id, type: 'token', text, thought: true }) })
  try {
    const response = await session.prompt(last.content, {
      ...samplingFor((req.side && side ? side.model : model)?.fileInfo.metadata.general.architecture),
      signal: ac.signal, stopOnAbortSignal: true, budgets, ...(maxTokens ? { maxTokens } : {}),
      functions: tools.length ? (toolFunctions(tools, onTool) as unknown as ChatSessionModelFunctions) : undefined,
      onTextChunk: (chunk) => { const text = clean.push(chunk); if (text) send({ id, type: 'token', text }) },
      onToken: () => timing.token(),
      onResponseChunk: (c) => {
        if (c.type === 'segment' && c.segmentType === 'thought') { thought += c.text; send({ id, type: 'token', text: c.text, thought: true }); timing.chunk('think', c.tokens.length) }
        else if (c.type === undefined) timing.chunk('write', c.tokens.length)
      },
    })
    const rest = clean.end()
    if (rest) send({ id, type: 'token', text: rest })
    return cleanAnswer(finalAnswer(response, thought))
  } finally {
    send({ id, type: 'timing', text: `${req.side ? 'side ' : ''}${describeTiming(timing.end())}` })
    aborts.delete(id)
    // the sequence stays: it holds what was just read, for the next message
    session.dispose({ disposeSequence: false })
  }
}

/**
 * gpt-oss takes a reasoning level (low, medium, high) in what it reads first; the rest, and gpt-oss at the default,
 * use the model's own chat format
 */
function wrapperFor(m: LlamaModel | undefined, reasoning?: 'low' | 'high'): 'auto' | ChatWrapper {
  if (!m || !reasoning || m.fileInfo.metadata.general.architecture !== 'gpt-oss') return 'auto'
  return resolveChatWrapper(m, { customWrapperSettings: { harmony: { reasoningEffort: reasoning } } })
}

/** read the conversation so far (and the start of the next user turn) into `main`, answering nothing */
async function preload(id: number, messages: ChatMessage[], tools: ToolSpec[], reasoning?: 'low' | 'high') {
  if (!main) return
  const session = new LlamaChatSession({ contextSequence: main, chatWrapper: wrapperFor(model, reasoning) })
  session.setChatHistory(toHistory(messages))
  const t0 = performance.now(), read = main.tokenMeter.usedInputTokens
  try {
    await session.preloadPrompt('', { functions: tools.length ? (toolFunctions(tools, async () => '') as unknown as ChatSessionModelFunctions) : undefined })
  } finally {
    send({ id, type: 'timing', text: `read ahead ${(main.tokenMeter.usedInputTokens - read).toLocaleString('en-US')} tok ${((performance.now() - t0) / 1000).toFixed(1)} s` })
    session.dispose({ disposeSequence: false })
  }
}

async function handle(req: EngineRequest): Promise<unknown> {
  if (req.type === 'probe') return probe()
  if (req.type === 'load') return load(req.modelPath, req.contextSize)
  if (req.type === 'chat') return chat(req.id, { ...req, tools: req.tools ?? [], thoughtBudget: req.thoughtBudget ?? CHAT_THOUGHT_BUDGET })
  if (req.type === 'preload') return preload(req.id, req.messages, req.tools ?? [], req.reasoning)
  if (req.type === 'loadSide') return loadSide(req.modelPath, req.contextSize)
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
