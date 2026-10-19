import type { NewSkill, PluginInfo, PluginResult, SkillRef, StarterRef } from './plugins'
import type { ApprovalAnswer, ApprovalRequest, Attachment, ChatSummary, FolderCheck, ModelRow, Project, ProjectInput, Step, StoredMessage, UserSettings } from './agent'

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export type ModelSummary = { id: string; name: string; sizeGB: number; estTokPerSec: number; blurb: string }

/** A row in the "choose a different model" list. */
export type ModelOption = ModelSummary & {
  description: string
  recommended: boolean
  available: boolean
  /** why it can't be picked: too big for memory, or too slow on this computer */
  reason?: 'memory' | 'slow'
  needsDiskGB: number
}

export type SetupState =
  | { phase: 'probing' }
  | { phase: 'choose'; recommended: ModelSummary; models: ModelOption[]; liteMode: boolean; needsDiskGB: number }
  | { phase: 'downloading'; target: ModelSummary; progress: number; etaSec: number; chatReady: boolean; note?: string }
  | { phase: 'ready'; model: ModelSummary; liteMode: boolean; note?: string; canRetry?: boolean }
  | { phase: 'error'; message: string }

export interface HobApi {
  platform: string
  /** test mode: canned model, search and dictation */
  fake: boolean
  copy(text: string): Promise<void>
  /** real paths of files dropped on the window */
  pathsForFiles(files: File[]): string[]
  /** URL that shows a local file (chat folders and project or chat folders only) */
  fileUrl(path: string): string
  setup: {
    getState(): Promise<SetupState>
    confirm(modelId?: string): Promise<void>
    retry(): Promise<void>
    onState(cb: (s: SetupState) => void): () => void
  }
  chats: {
    list(): Promise<ChatSummary[]>
    /** title matches first, then chats that mention it (with a snippet) */
    search(query: string): Promise<(ChatSummary & { snippet?: string })[]>
    get(id: string): Promise<{ chat: ChatSummary; messages: StoredMessage[] } | null>
    /** projectId: start it in that project */
    create(projectId?: string | null): Promise<ChatSummary>
    remove(id: string): Promise<void>
    /** every chat, gone from Hob; their files stay */
    removeAll(): Promise<void>
    onChanged(cb: () => void): () => void
  }
  files: {
    /** copy into the chat folder */
    add(chatId: string, paths: string[]): Promise<Attachment[] | { error: 'too-big'; gb: number } | { error: 'already-here'; message: string }>
    pick(): Promise<string[]>
    open(path: string): Promise<void>
    show(path: string): Promise<void>
    /** save a PNG (data URL) where the person picks; null if they cancel */
    saveImage(dataUrl: string, name: string): Promise<string | null>
  }
  projects: {
    list(): Promise<Project[]>
    create(p: ProjectInput): Promise<Project | { error: string }>
    update(id: string, p: ProjectInput): Promise<Project | { error: string }>
    /** its chats stay, outside any project; files aren't touched */
    remove(id: string): Promise<void>
    /** the folder picker; each folder says why Hob can't use it, if it can't */
    pickFolders(): Promise<FolderCheck[]>
    checkFolders(paths: string[]): Promise<FolderCheck[]>
    /** the main folder, in the file manager */
    open(id: string): Promise<void>
  }
  chat: {
    send(chatId: string, requestId: string, text: string, attachments: Attachment[]): Promise<StoredMessage>
    stop(requestId: string): Promise<void>
    /** thought = the model's hidden reasoning, shown only as a live preview */
    onToken(cb: (requestId: string, text: string, thought: boolean) => void): () => void
    onStep(cb: (requestId: string, step: Step) => void): () => void
    /** the reply streamed so far is being rewritten */
    onReset(cb: (requestId: string) => void): () => void
    onApproval(cb: (req: ApprovalRequest) => void): () => void
  }
  approval: { answer(id: string, answer: ApprovalAnswer): Promise<void> }
  /** failed: changes that couldn't be reversed (changed since, or too big to back up) */
  task: { undo(messageId: number): Promise<{ done: boolean; failed: number }> }
  settings: {
    get(): Promise<UserSettings>
    set(patch: Partial<UserSettings>): Promise<UserSettings>
    pickFilesDir(): Promise<string | null>
  }
  models: {
    list(): Promise<ModelRow[]>
    use(id: string): Promise<void>
    remove(id: string): Promise<boolean>
  }
  storage: { get(): Promise<{ modelsGB: number; filesGB: number; codeToolsGB: number }> }
  plugins: {
    list(): Promise<PluginInfo[]>
    setEnabled(id: string, on: boolean): Promise<void>
    /** choose a plugin folder or .zip and copy it into Hob */
    add(): Promise<PluginResult | null>
    /** developers: use a folder in place, reloaded on change */
    link(): Promise<PluginResult | null>
    remove(id: string): Promise<void>
    show(id: string): Promise<void>
    setSetting(id: string, key: string, value: string): Promise<void>
    /** replace: editing an existing skill */
    saveSkill(s: NewSkill, replace?: boolean): Promise<PluginResult>
    getSkill(name: string): Promise<NewSkill | null>
    removeSkill(name: string): Promise<void>
    /** an MCP server from a URL, a command or a pasted config; then connect() it */
    connectApp(o: { name: string; command: string; env?: string }): Promise<PluginResult>
    /** add a dropped plugin folder, .zip or .mcpb (asks first if it runs its own program); null: the user said no */
    addFile(path: string): Promise<PluginResult | null>
    /** connect now; opens the browser when the app asks the user to sign in */
    connect(id: string): Promise<PluginResult>
    cancelConnect(id: string): Promise<void>
    signOut(id: string): Promise<void>
    /** pick folders or files for a setting */
    choosePath(kind: 'directory' | 'file', multiple: boolean): Promise<string[]>
    /** a plugin file opened from Finder was added (or failed) */
    onOpened(cb: (r: PluginResult) => void): () => void
    skills(): Promise<SkillRef[]>
    starters(): Promise<StarterRef[]>
    onChanged(cb: () => void): () => void
  }
  speech: {
    /** downloads the dictation model on first use; fake in tests */
    prepare(): Promise<{ modelBase: string } | { fake: true }>
    onProgress(cb: (fraction: number) => void): () => void
    /** asks the OS for the microphone if it never has; false if the user said no */
    mic(): Promise<boolean>
    openMicSettings(): Promise<void>
  }
}
