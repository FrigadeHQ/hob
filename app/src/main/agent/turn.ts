import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, sep } from 'node:path'
import type { ApprovalAnswer, ApprovalRequest, Attachment, Step, StoredMessage, ToolSpec } from '../../shared/agent'
import type { ChatMessage } from '../../shared/types'
import type { Engine } from '../engine'
import type { PythonRuntime } from '../python/runtime'
import type { Store } from '../store'
import { capOutput } from '../python/run'
import { specsFor } from '../tools'
import { Journal } from './journal'
import { fitHistory, ToolBudget } from './history'
import { decide } from './permissions'
import { asksToProceed, claimCheck, claimsFileChanges, missingCheck, NOTHING_CHANGED, unbackedFiles, proceedCheck, unfinishedCheck } from './claims'
import { chatTitle, cleanTitle, expandCommand, systemPrompt, titleRequest, type PromptSkill } from './prompt'
import { repeatCut } from './repeat'
import type { Tool, TurnCtx } from './tool'
import { isInside } from '../workspace'

const CHANGES = new Set(['write_file', 'move_file', 'move_files', 'delete_file'])
/** what "renamed / moved / deleted" in a reply has to be backed by */
const MOVES = new Set(['move_file', 'move_files', 'delete_file'])

export const CHAT_BUDGET = 256
export const AGENT_BUDGET = 8192

export type TurnDeps = {
  engine: Engine
  /** Garth's eyes, for look_at_image */
  vision?: TurnCtx['vision']
  store: Store
  tools: Tool<any>[]
  python: PythonRuntime | undefined
  webAccess(): boolean
  trash(path: string): Promise<void>
  undoDir: string
  runTmp: string
  /** Garth's own settings folder: never offered as a folder to give access to */
  appData?: string
  /** the user's home folder (tests use a pretend one) */
  home?: string
  fetch?: typeof fetch
  search?: TurnCtx['search']
  render?: TurnCtx['render']
  approve(req: ApprovalRequest, signal: AbortSignal): Promise<ApprovalAnswer>
  /** show a folder (folder: true) or a file in its folder, in the file manager */
  reveal?(path: string, folder: boolean): Promise<void>
  /** skills from plugins that are on: listed in the prompt, and run directly with /name */
  skills?: { list(): (PromptSkill & { dir?: string; network?: boolean; packages?: string[] })[]; find(name: string): { name: string; body: string; dir: string; network?: boolean; packages?: string[] } | undefined }
  /** instructions from plugins that are on, given the tools offered this turn */
  prompts?(offered: string[]): string[]
  /** the chat list changed (e.g. the chat got its title) */
  onChatsChanged?(): void
  /** the reply and its follow-up jobs are done: the model is free to read ahead */
  onIdle?(): void
  emit: {
    token(requestId: string, text: string, thought: boolean): void
    step(requestId: string, step: Step): void
    /** the reply so far is being replaced (Garth caught it claiming something it didn't do) */
    reset?(requestId: string): void
  }
}
export type TurnArgs = { chatId: string; requestId: string; text: string; attachments: Attachment[]; signal: AbortSignal }

const withFiles = (content: string, attachments: Attachment[]) => {
  if (!attachments.length) return content
  const seen = attachments.filter((f) => f.seen).map((f) => PDF.test(f.name) ? `[What's in ${f.name}, read by Garth:\n${f.seen}]` : `[What's in ${f.name}, seen by Garth's image model: ${f.seen}]`)
  return [`${content}\n\n[Attached: ${attachments.map((f) => f.name).join(', ')}]`, ...seen].join('\n')
}
/** photos the image model can look at */
const PHOTO = /\.(jpe?g|png|gif|bmp|webp|heic|heif|tiff?|avif)$/i
const PDF = /\.pdf$/i
/** what's kept of an attached PDF for the reply and follow-ups; read_pdf with pages reads more */
const PDF_SEEN_CHARS = 12_000

/** One user message → model + tools → stored assistant reply. */
export async function runTurn(d: TurnDeps, a: TurnArgs): Promise<StoredMessage> {
  const started = Date.now()
  const chat = d.store.getChat(a.chatId)
  if (!chat) throw new Error('Chat not found')
  // the first line names the chat at once; the model writes a proper title after its first reply
  const firstTurn = chat.title === 'New chat'
  const placeholder = chatTitle(a.text)
  if (firstTurn) { d.store.renameChat(a.chatId, placeholder); d.onChatsChanged?.() }
  const history = d.store.messages(a.chatId)
  const userMessage = d.store.addMessage(a.chatId, { role: 'user', content: a.text, attachments: a.attachments })

  const project = chat.projectId ? d.store.getProject(chat.projectId) : undefined
  /** a folder that's gone (deleted, drive unplugged) can't be used: making files there would quietly recreate it */
  const missingFolders = (project?.folders ?? []).filter((f) => !existsSync(f))
  const projectFolders = (project?.folders ?? []).filter((f) => !missingFolders.includes(f))
  /** folders allowed from this chat (the access card), apart from the project's */
  const chatGrants = d.store.chatGrants(a.chatId)
  const grants = [...projectFolders, ...chatGrants]
  const always = d.store.alwaysFolders(a.chatId)
  const taskId = randomUUID()
  const journal = new Journal({ backupDir: join(d.undoDir, taskId), save: (op) => d.store.addUndoOp(taskId, op) })
  const ctx: TurnCtx = {
    chatDir: chat.dir, grants, signal: a.signal, untrusted: false, webAccess: d.webAccess(),
    mainFolder: project?.folders[0], missingFolders, reveal: d.reveal,
    journal, trash: d.trash, python: d.python, runTmp: d.runTmp, fetch: d.fetch ?? fetch, search: d.search, render: d.render,
    skillScript: (ref) => skillScript(ref, d.skills), vision: d.vision,
  }
  const steps: Step[] = []
  const show = (s: Step) => {
    const i = steps.findIndex((x) => x.id === s.id)
    if (i === -1) steps.push(s); else steps[i] = s
    d.emit.step(a.requestId, s)
  }

  /** changes already made this turn: models sometimes re-issue them; don't redo or re-show */
  const changesDone = new Set<string>()
  const results = new Map<string, string>()
  const budget = new ToolBudget()
  /** a move, rename or delete actually happened this turn */
  let moved = false
  /** a tool looked at something outside the chat folder */
  let outside = false

  // stuck models repeat whole paragraphs; stop them instead of letting them run to the step limit
  const loop = new AbortController()
  let streamed = ''
  let cut = -1
  const onToken = (t: string, thought?: boolean) => {
    d.emit.token(a.requestId, t, !!thought)
    if (thought || cut !== -1) return
    streamed += t
    cut = repeatCut(streamed)
    if (cut !== -1) loop.abort()
  }

  async function onTool(name: string, args: unknown): Promise<string> {
    // the worker may already have sent this call when the user pressed Stop
    if (a.signal.aborted || loop.signal.aborted) return 'Stopped by the user.'
    // small models hand web addresses to read_file; read the page instead of looking for it on disk
    const link = name === 'read_file' && String((args as { path?: unknown } | null)?.path ?? '').trim()
    if (link && /^https?:\/\//i.test(link) && d.tools.some((t) => t.spec.name === 'fetch_url')) { name = 'fetch_url'; args = { url: link } }
    const tool = d.tools.find((t) => t.spec.name === name)
    if (!tool) return `There is no tool called ${name}.`
    const raw = (args ?? {}) as Record<string, unknown>
    let input = raw
    try { input = tool.prepare ? tool.prepare(raw, ctx) : raw } catch { /* the tool reports bad arguments itself */ }
    const key = `${name}:${JSON.stringify(input)}`
    if (changesDone.has(key)) return 'Already done earlier in this task. Continue with the next step.'
    // models sometimes loop on the same call; give back the earlier result instead of running it again
    const earlier = results.get(key)
    if (earlier !== undefined) return `You already did exactly this earlier in this task. The result was:\n${earlier.slice(0, 2000)}\nDon't repeat it; continue with something else.`
    const step: Step = { id: randomUUID(), title: tool.title(input), status: 'running', tool: name }
    const refused = tool.refuse?.(input, ctx)
    if (refused) { show({ ...step, status: 'denied', reason: short(refused) }); return refused }
    show(step)
    try {
      const action = tool.action(input, ctx)
      const gate = () => decide(action, { chatDir: ctx.chatDir, grants, project: projectFolders, always, untrusted: ctx.untrusted, webAccess: ctx.webAccess, appData: d.appData, home: d.home ?? homedir() })
      let decision = gate()
      let granted: string | undefined
      if ('paths' in action && action.paths.some((p) => !p.startsWith(ctx.chatDir))) outside = true
      if (decision.verdict === 'grant') {
        // a folder Garth can't use yet: ask the user right here instead of failing
        const folder = decision.folder
        const home = d.home ?? homedir()
        const shown = folder.startsWith(home + sep) ? `~${folder.slice(home.length)}` : folder
        show({ ...step, status: 'waiting' })
        const answer = await d.approve({ id: step.id, requestId: a.requestId, text: `Let Garth use your “${basename(folder)}” folder?`, detail: shown, access: true }, a.signal)
        if (answer === 'deny') {
          show({ ...step, status: 'denied', reason: 'You said not now.' })
          return `The user didn't give Garth access to ${folder}. Don't try again. Tell them it isn't done, and that they can add the folder to a project (the + next to Projects in the sidebar).`
        }
        // for this chat only; folders Garth uses again and again belong in a project
        d.store.addChatGrant(a.chatId, folder)
        grants.push(folder)
        chatGrants.push(folder)
        granted = folder
        show({ ...step, status: 'running' })
        decision = gate()
      }
      if (decision.verdict === 'deny') { show({ ...step, status: 'denied', reason: short(decision.reason) }); return decision.reason }
      if (decision.verdict === 'grant') { show({ ...step, status: 'denied', reason: 'Garth has no access to that folder.' }); return 'Garth still has no access to that folder.' }
      if (decision.verdict === 'ask') {
        show({ ...step, status: 'waiting' })
        const answer = await d.approve({ id: step.id, requestId: a.requestId, text: tool.ask?.(input) ?? `${step.title}?`, folder: decision.folder, ...(tool.askDetail ? { detail: tool.askDetail(input) } : {}) }, a.signal)
        if (answer === 'deny') { show({ ...step, status: 'denied', reason: 'You said no.' }); return "The user said no. Don't retry; tell them what you would have done." }
        if (answer === 'always' && decision.folder) { d.store.addAlways(a.chatId, decision.folder); always.push(decision.folder) }
        show({ ...step, status: 'running' })
      }
      ctx.progress = (title) => show({ ...step, title, status: 'running' })
      const out = await tool.run(input, ctx)
      if (!out.failed && CHANGES.has(name)) changesDone.add(key)
      if (!out.failed && MOVES.has(name)) moved = true
      show({ ...step, ...(out.title ? { title: out.title } : {}), status: out.failed ? 'error' : 'done', ...(out.failed ? { reason: short(out.text) } : {}), ...(out.detail ? { detail: out.detail } : {}), ...(out.files?.length ? { files: out.files } : {}), ...(out.uses?.length ? { uses: out.uses } : {}) })
      const text = budget.take(capOutput(out.text))
      results.set(key, text)
      // the system prompt was written before this folder was allowed
      return granted ? `${grantedNote(granted)}\n\n${text}` : text
    } catch (err) {
      show({ ...step, status: 'error', reason: short(err instanceof Error ? err.message : String(err)) })
      return `Error: ${err instanceof Error ? err.message : String(err)}`
    } finally {
      ctx.progress = undefined
    }
  }

  const lookNotes: string[] = []
  // attached photos: look first. Small models answer from the file name instead of calling the tool
  const looking = d.tools.some((t) => t.spec.name === 'look_at_image') && d.vision && d.vision.state().phase !== 'off'
  if (looking && a.attachments.some((f) => PHOTO.test(f.name))) {
    for (const f of a.attachments) {
      if (!PHOTO.test(f.name) || a.signal.aborted) continue
      const said = await onTool('look_at_image', { path: f.path })
      if (steps.at(-1)?.status === 'done') f.seen = said
      else lookNotes.push(`[Couldn't look at ${f.name}: ${said}]`)
    }
    d.store.setAttachments(userMessage, a.attachments)
  }
  // attached PDFs: read first too, pictures of pages included (read_pdf hands those to the image model)
  const readsPdfs = process.platform === 'darwin' && d.tools.some((t) => t.spec.name === 'read_pdf')
  if (readsPdfs && a.attachments.some((f) => PDF.test(f.name))) {
    for (const f of a.attachments) {
      if (!PDF.test(f.name) || f.seen || a.signal.aborted) continue
      const said = await onTool('read_pdf', { path: f.path })
      if (steps.at(-1)?.status === 'done') f.seen = said.length > PDF_SEEN_CHARS ? `${said.slice(0, PDF_SEEN_CHARS)}… (more: read_pdf with pages)` : said
      else lookNotes.push(`[Couldn't read ${f.name}: ${said}]`)
    }
    d.store.setAttachments(userMessage, a.attachments)
  }

  const listing = listDir(chat.dir)
  const specs = specsFor(d.tools, ctx.webAccess)
  const command = expandCommand(a.text, (n) => d.skills?.find(n))
  const messages: ChatMessage[] = [
    ...conversation(d, chat, history, specs, a.text),
    { role: 'user', content: [withFiles(command.text, a.attachments), ...lookNotes].join('\n') },
  ]
  // file work from the start: signals that don't depend on the language the user writes in. Anything else
  // starts with a short think and gets the long one as soon as the model calls a tool
  const namesPath = /~[\\/]|\/Users\/|\/home\/|[A-Z]:\\/.test(a.text)
  const usesFiles = listing.length > 0 || grants.length > 0 || a.attachments.length > 0 || command.skill !== undefined || namesPath
  let content: string
  const ask = (msgs: ChatMessage[]) => d.engine.chat(
    { messages: msgs, tools: specs, thoughtBudget: usesFiles ? AGENT_BUDGET : CHAT_BUDGET, thoughtBudgetWithTools: AGENT_BUDGET },
    { onToken, onTool },
    AbortSignal.any([a.signal, loop.signal]),
  ).then((t) => t.trim())
  /** the task is about the user's own files: a tool looked outside the chat folder, or a folder was named */
  const aboutTheirFiles = (reply: string) => {
    const names = grants.map((g) => basename(g))
    return outside || [a.text, reply].some((t) => /~[\\/]|\/Users\/|\/home\/|[A-Z]:\\/.test(t) || names.some((n) => n && t.includes(n)))
  }
  /** "The files have been renamed" when nothing was: small models do this; check before the user believes it */
  const unbacked = (reply: string) => !moved && claimsFileChanges(reply) && aboutTheirFiles(reply)
  /** a file name that's in the chat folder (or one below it), the user's folders, or the request itself */
  const onDisk = (name: string) => a.text.includes(name) || [chat.dir, ...grants].some((dir) => existsSync(join(dir, name)) || listDir(dir).some((sub) => existsSync(join(dir, sub, name))))
  try {
    let final = await ask(messages)
    // one more go when the reply says it changed files but didn't, or stops to ask "shall I go ahead?" on a task about the user's files
    const missing = unbackedFiles(final, { made: steps.filter((s) => s.status === 'done').flatMap((s) => s.files ?? []), exists: onDisk })
    const check = unbacked(final) ? 'claim'
      : !final && steps.length > 0 ? 'unfinished'
      : missing.length ? 'missing'
      : !moved && aboutTheirFiles(final) && !steps.some((s) => s.status === 'denied') && asksToProceed(final) ? 'proceed' : undefined
    if (!a.signal.aborted && cut === -1 && check) {
      d.emit.reset?.(a.requestId)
      streamed = ''
      const ran = steps.map((s) => `${s.title} (${s.status === 'done' ? 'worked' : s.status})`)
      final = await ask([...messages, { role: 'assistant', content: final }, { role: 'user', content: check === 'claim' ? claimCheck(ran) : check === 'unfinished' ? unfinishedCheck(ran) : check === 'missing' ? missingCheck(missing) : proceedCheck() }])
      if (!a.signal.aborted && unbacked(final)) final = `${final}\n\n${NOTHING_CHANGED}`
    }
    content = a.signal.aborted ? (final ? `${final}\n\n*Stopped.*` : '*Stopped.*') : final || "I couldn't come up with an answer. Try rephrasing."
  } catch (err) {
    console.error(err)
    content = a.signal.aborted ? '*Stopped.*' : 'Something went wrong. Try again.'
  }
  if (cut !== -1 && !a.signal.aborted) {
    content = `${streamed.slice(0, cut).trim()}\n\n*I started repeating myself, so I stopped. Try asking again, a bit more specifically.*`
  }
  for (const s of steps) if (s.status === 'running' || s.status === 'waiting') s.status = 'error'
  const undoable = journal.count > 0
  const workedMs = Date.now() - started
  const id = d.store.addMessage(a.chatId, { role: 'assistant', content, steps, taskId, undoable, workedMs })
  const naming = firstTurn && !a.signal.aborted && cut === -1 && content !== 'Something went wrong. Try again.' ? nameChat(d, a.chatId, placeholder, a.text, content) : Promise.resolve()
  // the model is free again (naming done too): time to read ahead whatever the user looks at now
  void naming.then(() => d.onIdle?.()).catch(() => {})
  return { id, role: 'assistant', content, attachments: [], steps, taskId, undoable, undone: false, workedMs }
}

const listDir = (dir: string) => { try { return readdirSync(dir).filter((n) => !n.startsWith('.')) } catch { return [] } }

type PromptDeps = Pick<TurnDeps, 'store' | 'skills' | 'prompts' | 'home'>
type ChatRef = { id?: string; dir: string; projectId: string | null }

/**
 * The conversation as the model reads it, before the new message: the system prompt and the history.
 * Built the same way for a reply and for reading ahead, so what was read ahead is reused (any difference
 * means reading again from that point). text: the new message, when known (it changes a few details).
 */
export function conversation(d: PromptDeps, chat: ChatRef, history: StoredMessage[], specs: ToolSpec[], text = ''): ChatMessage[] {
  const project = chat.projectId ? d.store.getProject(chat.projectId) : undefined
  const missing = (project?.folders ?? []).filter((f) => !existsSync(f))
  const chatGrants = chat.id ? d.store.chatGrants(chat.id) : []
  const mainFolder = project?.folders[0]
  const find = (n: string) => d.skills?.find(n)
  const command = expandCommand(text, find)
  // the latest earlier /command keeps its instructions, so follow-ups ("make it shorter") still know them;
  // older ones stay short to save room
  let lastCommand = -1
  if (!command.skill) for (let i = history.length - 1; i >= 0 && lastCommand === -1; i--) if (history[i].role === 'user' && expandCommand(history[i].content, find).skill) lastCommand = i
  const expand = (t: string, i: number) => (i === lastCommand ? expandCommand(t, find).text : t)
  // "save that as a skill": the model only sees earlier replies' words, so give it the code that worked
  const lastReply = /\bskill/i.test(text) && !command.skill ? history.map((m) => m.role).lastIndexOf('assistant') : -1
  return [
    { role: 'system', content: systemPrompt({ chatDir: chat.dir, files: listDir(chat.dir), grants: chatGrants, project: project && { name: project.name, instructions: project.instructions, folders: project.folders, missing, files: mainFolder ? listDir(mainFolder) : [] }, home: d.home ?? homedir(), tools: d.skills ? specs.map((s) => s.name) : undefined, skills: d.skills?.list(), extra: d.prompts?.(specs.map((s) => s.name)) }) },
    ...fitHistory(history.map((m, i) => ({ role: m.role, content: withFiles(expand(m.content, i), m.attachments) + (i === lastReply ? codeThatWorked(m.steps) : '') }))),
  ]
}

/** Read a chat ahead (or a new chat that will use this folder), so its next message starts at once. */
export async function readAhead(d: PromptDeps & Pick<TurnDeps, 'engine' | 'tools' | 'webAccess'>, chat: ChatRef): Promise<void> {
  const specs = specsFor(d.tools, d.webAccess())
  await d.engine.preload(conversation(d, chat, chat.id ? d.store.messages(chat.id) : [], specs), specs)
}

/** what the model can now do in a folder the user just allowed */
export const grantedNote = (folder: string) =>
  `The user just gave Garth access to ${folder}. You can now read everything there, including with run_python and photo_info. Change files there with move_files (many at once), move_file, write_file and delete_file; Garth asks the user before each change, so just call them.`

/** Ask the model for a short title; keeps the first-line title if anything goes wrong. */
async function nameChat(d: TurnDeps, chatId: string, placeholder: string, user: string, reply: string) {
  const ask = () => d.engine.chat({ messages: titleRequest(user, reply), tools: [], thoughtBudget: 0, maxTokens: 24, side: true }, { onToken: () => {} }, AbortSignal.timeout(30_000))
  try {
    // one retry: the engine can be briefly busy right after a reply
    const raw = await ask().catch(async () => { await new Promise((r) => setTimeout(r, 1500)); return ask() })
    const title = cleanTitle(raw)
    // the chat may have been deleted or renamed meanwhile
    if (!title || d.store.getChat(chatId)?.title !== placeholder) return
    d.store.renameChat(chatId, title)
    d.onChatsChanged?.()
  } catch (err) {
    console.warn('naming the chat failed', err)
  }
}

/** a skill's script by "skill-name/file.py" or full path; only skills that are on */
export function skillScript(ref: string, skills: TurnDeps['skills']): { path: string; dir: string; network: boolean; packages?: string[] } | undefined {
  const m = /^([a-z0-9][a-z0-9-]*)[\\/]([^\\/]+)$/.exec(ref)
  if (m) {
    const s = skills?.find(m[1])
    return s ? { path: join(s.dir, m[2]), dir: s.dir, network: !!s.network, ...(s.packages ? { packages: s.packages } : {}) } : undefined
  }
  if (!isAbsolute(ref)) return undefined
  const s = skills?.list().find((x) => x.dir && isInside(x.dir, ref))
  return s?.dir ? { path: ref, dir: s.dir, network: !!s.network, ...(s.packages ? { packages: s.packages } : {}) } : undefined
}

const CODE_CHARS = 8000
/** the code of the steps that worked, for saving it as a skill's script */
function codeThatWorked(steps: Step[]): string {
  const code = steps.filter((s) => s.tool === 'run_python' && s.status === 'done' && s.detail).map((s) => s.detail!.split('\n\n--- output ---')[0].trim())
  if (!code.length) return ''
  return `\n\n[Code you ran for this, which worked:\n${code.map((c) => `\`\`\`python\n${c}\n\`\`\``).join('\n')}]`.slice(0, CODE_CHARS)
}

/** the first readable line of an error, for the work log: no tracebacks, no hints meant for the model */
export function short(text: string): string {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !/^(Traceback|File "|Exit code|\^+$|Garth: )/.test(l))
  const line = (lines.find((l) => /Error|error:|can't|couldn't|not found|No such|denied|failed/i.test(l)) ?? lines[0] ?? '').replace(/^Error:\s*/, '')
  const first = line.split(/(?<=[.!?])\s/)[0]
  return first.length > 160 ? `${first.slice(0, 159)}…` : first
}
