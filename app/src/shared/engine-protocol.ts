import type { ChatMessage } from './types'
import type { ToolSpec } from './agent'

export type GpuProbe = { gpuType: 'metal' | 'cuda' | 'vulkan' | false; vramTotalGB: number; unifiedGB: number; gpuNames: string[] }

export type EngineRequest =
  | { id: number; type: 'probe' }
  | { id: number; type: 'load'; modelPath: string; contextSize: number }
  | { id: number; type: 'chat'; messages: ChatMessage[]; tools: ToolSpec[]; thoughtBudget: number; maxTokens?: number }
  | { id: number; type: 'abort'; targetId: number }
  | { id: number; type: 'unload' }
  /** main → worker: answer to a tool-call event; gets no reply */
  | { id: number; type: 'tool-result'; callId: number; result: string }

export type EngineEvent =
  | { id: number; type: 'result'; data: unknown }
  | { id: number; type: 'token'; text: string; thought?: boolean }
  | { id: number; type: 'tool-call'; callId: number; name: string; args: unknown }
  | { id: number; type: 'error'; message: string; code?: 'OOM' }
