import type { ChatMessage } from './types'
import type { ToolSpec } from './agent'

export type GpuProbe = { gpuType: 'metal' | 'cuda' | 'vulkan' | false; vramTotalGB: number; unifiedGB: number; gpuNames: string[] }

export type EngineRequest =
  | { id: number; type: 'probe' }
  | { id: number; type: 'load'; modelPath: string; contextSize: number }
  /** thoughtBudgetWithTools: the budget once the model has called a tool (a task, not a quick answer).
   *  side: run on the small second model when one is loaded (naming a chat) */
  | { id: number; type: 'chat'; messages: ChatMessage[]; tools: ToolSpec[]; thoughtBudget: number; thoughtBudgetWithTools?: number; maxTokens?: number; side?: boolean; reasoning?: 'low' | 'high' }
  /** read a conversation ahead (system prompt, tools, history) so the next message in it starts at once */
  | { id: number; type: 'preload'; messages: ChatMessage[]; tools: ToolSpec[]; reasoning?: 'low' | 'high' }
  /** a small second model for side jobs; contextSize kept small */
  | { id: number; type: 'loadSide'; modelPath: string; contextSize: number }
  | { id: number; type: 'abort'; targetId: number }
  | { id: number; type: 'unload' }
  /** main → worker: answer to a tool-call event; gets no reply */
  | { id: number; type: 'tool-result'; callId: number; result: string }

export type EngineEvent =
  | { id: number; type: 'result'; data: unknown }
  | { id: number; type: 'token'; text: string; thought?: boolean }
  | { id: number; type: 'tool-call'; callId: number; name: string; args: unknown }
  /** where a reply's time went (engine/timing.ts), for the log */
  | { id: number; type: 'timing'; text: string }
  | { id: number; type: 'error'; message: string; code?: 'OOM' }
