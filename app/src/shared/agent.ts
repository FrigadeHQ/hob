import type { ModelOption } from './types'

/** A tool the model can call. params is a JSON schema object. */
export type ToolSpec = { name: string; description: string; params: Record<string, unknown> }

/** A file copied into a chat's folder. path is absolute. */
export type Attachment = { name: string; path: string; sizeBytes: number }

export type StepStatus = 'running' | 'waiting' | 'done' | 'error' | 'denied'
/** One agent action shown in the thread, e.g. "Read sales.csv". */
/** files: what the step made or changed (shown as cards). uses: files it only read to make them, e.g. a chart's data (no card) */
/** tool: the tool that ran this step (e.g. run_python) */
export type Step = { id: string; title: string; status: StepStatus; detail?: string; files?: string[]; uses?: string[]; tool?: string }

/** access: Hob asks to use a folder it can't see yet (allow adds it to the folders it can use) */
export type ApprovalRequest = { id: string; requestId: string; text: string; folder?: string; detail?: string; access?: boolean }
export type ApprovalAnswer = 'allow' | 'always' | 'deny'

/** projectId: the project the chat is in; null for chats outside any project */
export type ChatSummary = { id: string; title: string; dir: string; updatedAt: number; projectId: string | null }
/** folders[0] is the main folder: new files go there. missing: folders that can't be found right now */
export type Project = { id: string; name: string; instructions: string; folders: string[]; missing: string[] }
export type ProjectInput = { name: string; instructions: string; folders: string[] }
/** a folder the user picked; problem: why Hob can't use it */
export type FolderCheck = { path: string; problem?: string }
export type StoredMessage = {
  id: number
  role: 'user' | 'assistant'
  content: string
  attachments: Attachment[]
  steps: Step[]
  taskId?: string
  undoable: boolean
  undone: boolean
  /** how long the agent worked on this reply */
  workedMs?: number
}

export type UserSettings = { webAccess: boolean; filesDir: string }
export type ModelRow = ModelOption & { downloaded: boolean; active: boolean }
