import { useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowDown, Clock, Paperclip, Sparkles, Undo2, X } from 'lucide-react'
import type { ApprovalRequest, Attachment, Project, StoredMessage } from '../../../shared/agent'
import type { SkillRef, StarterRef } from '../../../shared/plugins'
import { PluginIcon } from '../components/ui'
import { hob } from '../api'
import { CopyButton } from '../components/CopyButton'
import { WorkLog } from '../components/WorkLog'
import { FileCards } from '../components/FileCards'
import { ApprovalCard } from '../components/ApprovalCard'
import { AttachmentChip, Composer } from '../components/Composer'
import { ProjectChip } from '../components/ProjectChip'
import { folderName } from '../components/ProjectDialog'
import { useDictation } from '../speech/useDictation'
import { tidyMarkdown } from '../../../shared/markdown'
import { pickStarters } from '../starters'
import { skillOffer } from '../../../shared/skillOffer'

/** "/plan-trip Rome" shows the command as a label */
function UserText({ text, skills }: { text: string; skills: SkillRef[] }) {
  const m = /^\/([a-z0-9-]+)(\s[\s\S]*)?$/.exec(text)
  if (!m || !skills.some((s) => s.name === m[1])) return <>{text}</>
  return <><span data-testid="command-label" className="font-medium text-ink-soft">/{m[1]}</span>{m[2] ?? ''}</>
}

// Model text can be steered by documents or web pages: an <img> to an outside URL would send data out
// without asking. Only local files the agent made may show; anything else stays as its alt text.
const MARKDOWN_COMPONENTS = {
  img: ({ src, alt }: { src?: unknown; alt?: string }) =>
    typeof src === 'string' && src.startsWith('hob-file:') ? <img src={src} alt={alt ?? ''} /> : <span>{alt}</span>,
}

type UiMessage = Omit<StoredMessage, 'id'> & { id: number | string }
const userMsg = (rid: string, content: string, attachments: Attachment[]): UiMessage => ({ id: `u-${rid}`, role: 'user', content, attachments, steps: [], undoable: false, undone: false })
const placeholder = (rid: string): UiMessage => ({ id: `a-${rid}`, role: 'assistant', content: '', attachments: [], steps: [], undoable: false, undone: false })

type Props = {
  chatId: string | null
  /** a new chat starts in this project */
  projectId: string | null
  /** the user picked another project for this new chat */
  onProjectChange(id: string | null): void
  /** open Create project; folders: start it with these */
  onNewProject(folders?: string[]): void
  /** this view's chat now exists / changed: select it and refresh the sidebar */
  onChatChanged(id: string): void
  /** a chat changed after the user left it: refresh the sidebar only */
  onRefresh(): void
}

export function ChatView({ chatId: initialId, projectId: initialProject, onProjectChange, onNewProject, onChatChanged, onRefresh }: Props) {
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState<Attachment[]>([])
  /** folders: offer to make a project for them (things too big to copy) */
  const [notice, setNotice] = useState<{ text: string; folders?: string[] } | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState<string | null>(initialProject)
  const projectRef = useRef(initialProject)
  /** the chat exists, so its project is settled */
  const [created, setCreated] = useState(!!initialId)
  useEffect(() => {
    const load = () => void hob.projects.list().then(setProjects)
    load()
    return hob.chats.onChanged(load)
  }, [])
  const project = projects.find((p) => p.id === projectId)
  // a project made from this new chat (chip, too-big notice): use it here, keeping what was typed
  useEffect(() => { if (!created) { projectRef.current = initialProject; setProjectId(initialProject) } }, [initialProject])
  const pickProject = (id: string | null) => { projectRef.current = id; setProjectId(id); onProjectChange(id) }
  const [dragging, setDragging] = useState(false)
  const [requestId, setRequestId] = useState<string | null>(null)
  const [approval, setApproval] = useState<ApprovalRequest | null>(null)
  const [skills, setSkills] = useState<SkillRef[]>([])
  const [starters, setStarters] = useState<StarterRef[]>([])
  const [seed] = useState(() => Math.floor(Math.random() * 1000))
  useEffect(() => {
    const load = () => { void hob.plugins.skills().then(setSkills); void hob.plugins.starters().then(setStarters) }
    load()
    return hob.plugins.onChanged(load)
  }, [])
  const scroller = useRef<HTMLDivElement>(null)
  const dictation = useDictation((text) => { setInput((cur) => (cur.trim() ? `${cur.trimEnd()} ${text}` : text)); inputRef.current?.focus() })
  /** follow new text only while the user is at the bottom; scrolling up stops it */
  const pinned = useRef(true)
  const [showJump, setShowJump] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const currentId = useRef<string | null>(null)
  const chatIdRef = useRef(initialId)
  const dragDepth = useRef(0)
  const alive = useRef(true)
  /** live reasoning of the reply in progress; WorkLog reads it at its own calm pace */
  const thoughtBuf = useRef('')
  const clearThinking = () => { thoughtBuf.current = '' }

  // the view is keyed per chat, so history loads once; later chatId changes are this view creating its chat
  useEffect(() => {
    if (!initialId) return
    void hob.chats.get(initialId).then((r) => {
      if (!r || !alive.current) return
      setProjectId(r.chat.projectId)
      // a reply that kept going while another chat was open: show it so far and follow it again
      if (r.live) {
        const rid = r.live.requestId
        currentId.current = rid
        setRequestId(rid)
        setApproval(r.live.approval ?? null)
        setMessages([...r.messages, { ...placeholder(rid), content: r.live.content, steps: r.live.steps }])
      } else setMessages(r.messages)
    })
  }, [])
  // leaving this chat (New chat, another chat) doesn't stop its reply: it keeps going and is saved
  useEffect(() => () => { alive.current = false }, [])
  useEffect(() => hob.chat.onDone((rid, reply) => {
    if (rid !== currentId.current) return
    currentId.current = null
    setMessages((ms) => [...ms.slice(0, -1), reply ?? { ...placeholder(rid), content: 'Something went wrong. Try again.' }])
    setRequestId(null); setApproval(null); clearThinking(); inputRef.current?.focus()
  }), [])

  useEffect(() => hob.chat.onToken((id, text, thought) => {
    if (id !== currentId.current) return
    if (thought) { thoughtBuf.current += text; return }
    clearThinking()
    setMessages((ms) => {
      const last = ms.at(-1)
      if (!last || last.role !== 'assistant' || id !== currentId.current) return ms
      return [...ms.slice(0, -1), { ...last, content: last.content + text }]
    })
  }), [])
  useEffect(() => hob.chat.onReset((rid) => {
    if (rid !== currentId.current) return
    setMessages((ms) => {
      const last = ms.at(-1)
      return last?.role === 'assistant' ? [...ms.slice(0, -1), { ...last, content: '' }] : ms
    })
  }), [])
  useEffect(() => hob.chat.onStep((rid, step) => {
    if (rid !== currentId.current) return
    setMessages((ms) => {
      const last = ms.at(-1)
      if (!last || last.role !== 'assistant') return ms
      const i = last.steps.findIndex((s) => s.id === step.id)
      const steps = i === -1 ? [...last.steps, step] : last.steps.map((s, j) => (j === i ? step : s))
      return [...ms.slice(0, -1), { ...last, steps }]
    })
  }), [])
  useEffect(() => hob.chat.onApproval((req) => { if (req.requestId === currentId.current) setApproval(req) }), [])
  useEffect(() => { if (pinned.current) scroller.current?.scrollTo({ top: scroller.current.scrollHeight }) }, [messages])
  function onScroll() {
    const el = scroller.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    pinned.current = atBottom
    setShowJump(!atBottom)
  }
  function jumpToLatest() {
    pinned.current = true
    setShowJump(false)
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }

  async function ensureChat() {
    if (chatIdRef.current) return chatIdRef.current
    const c = await hob.chats.create(projectRef.current)
    chatIdRef.current = c.id
    setCreated(true)
    onChatChanged(c.id)
    return c.id
  }

  async function addFiles(paths: string[]): Promise<Attachment[] | undefined> {
    if (!paths.length) return
    let r: Awaited<ReturnType<typeof hob.files.add>>
    try {
      r = await hob.files.add(await ensureChat(), paths)
    } catch (err) {
      console.error(err)
      setNotice({ text: "Couldn't add those files." })
      return
    }
    if ('error' in r) {
      setNotice(r.error === 'too-big'
        ? { text: `That's ${r.gb.toFixed(1)} GB, too big to copy. Make a project for its folder instead, so Hob can use it where it is.`, folders: paths }
        : { text: `${r.message}.` })
      return
    }
    setNotice(null)
    setPending((p) => [...p, ...r])
    inputRef.current?.focus()
    return r
  }

  /** an idea that needs a file: pick one, then send */
  async function startWithFile(prompt: string) {
    const added = await addFiles(await hob.files.pick())
    if (added?.length) await send(prompt, [...pending, ...added])
  }

  function stop() {
    if (requestId) void hob.chat.stop(requestId)
  }

  // "Save as a skill": once per chat; closing it or saying yes hides it for good (only a convenience, so storage may fail)
  const offerKey = () => `hob-skill-offer:${chatIdRef.current}`
  const [offerClosed, setOfferClosed] = useState(() => { try { return !!initialId && localStorage.getItem(`hob-skill-offer:${initialId}`) === 'closed' } catch { return false } })
  function closeOffer() {
    setOfferClosed(true)
    try { localStorage.setItem(offerKey(), 'closed') } catch { /* private window */ }
  }
  const offerAt = offerClosed || requestId ? -1 : skillOffer(messages, skills.map((s) => s.name))

  const [undoNotes, setUndoNotes] = useState<Record<number, string>>({})
  async function undoTask(id: number) {
    try {
      const r = await hob.task.undo(id)
      if (!r.done) return
      setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, undone: true } : m)))
      if (r.failed) setUndoNotes((n) => ({ ...n, [id]: `Undone, except ${r.failed} change${r.failed > 1 ? 's' : ''} that changed since or ${r.failed > 1 ? 'are' : 'is'} in the Trash` }))
    } catch (err) {
      console.error(err)
      setUndoNotes((n) => ({ ...n, [id]: "Couldn't undo these changes" }))
    }
  }

  // typed while Hob was still working: sent as soon as the reply is done
  const [queued, setQueued] = useState<string | null>(null)
  useEffect(() => {
    if (requestId || !queued) return
    const next = queued
    setQueued(null)
    void send(next)
  }, [requestId, queued])

  async function send(prompt?: string, attached?: Attachment[]) {
    const text = (prompt ?? input).trim()
    if (text && requestId && prompt === undefined) { setQueued(text); setInput(''); return }
    if (!text || requestId) return
    const rid = crypto.randomUUID()
    const files = attached ?? pending
    setMessages((ms) => [...ms, userMsg(rid, text, files), placeholder(rid)])
    setInput(''); setPending([]); setNotice(null)
    setRequestId(rid); currentId.current = rid; clearThinking()
    pinned.current = true
    let id: string | undefined
    try {
      id = await ensureChat()
      const reply = await hob.chat.send(id, rid, text, files)
      if (currentId.current === rid) setMessages((ms) => [...ms.slice(0, -1), reply])
    } catch (err) {
      console.error(err)
      if (currentId.current === rid) setMessages((ms) => [...ms.slice(0, -1), { ...placeholder(rid), content: 'Something went wrong. Try again.' }])
    } finally {
      if (currentId.current === rid) { currentId.current = null; setRequestId(null); setApproval(null); clearThinking(); inputRef.current?.focus() }
      if (id) { if (alive.current) onChatChanged(id); else onRefresh() }
    }
  }

  return (
    <main
      className="relative flex min-w-0 flex-1 flex-col bg-paper"
      onDragEnter={(e) => { if (!e.dataTransfer.types.includes('Files')) return; e.preventDefault(); dragDepth.current++; setDragging(true) }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }}
      onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false) }}
      onDrop={(e) => { e.preventDefault(); dragDepth.current = 0; setDragging(false); void addFiles(hob.pathsForFiles(Array.from(e.dataTransfer.files))) }}
    >
      {dragging && (
        <div data-testid="drop-overlay" className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-composer border-2 border-dashed border-line-strong bg-paper/85 text-body font-medium">
          Drop files to add them
        </div>
      )}
      <div className="drag h-12 shrink-0" />
      <div ref={scroller} onScroll={onScroll} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[720px] space-y-8 px-6 pb-10">
          {messages.length === 0 && (
            <div className="pt-24 text-center">
              {project
                ? <>
                    <h1 className="text-title font-semibold tracking-tight">What should we do in {project.name}?</h1>
                    <p className="mt-2 text-body text-ink-soft">{project.folders.length ? `Hob can use the files in ${project.folders.map(folderName).join(', ')}. New files go in ${folderName(project.folders[0])}.` : 'Chats here follow this project\'s instructions.'}</p>
                  </>
                : <>
                    <h1 className="text-title font-semibold tracking-tight">What can Hob do for you?</h1>
                    <p className="mt-2 text-body text-ink-soft">Private, on your computer. Drop in files to work with them.</p>
                  </>}
              <div className="mt-8 grid gap-2 text-left sm:grid-cols-2">
                {pickStarters(starters, seed).map((s) => (
                  <button key={s.title} data-testid="suggestion" data-file={!!s.file} onClick={() => void (s.file ? startWithFile(s.prompt) : send(s.prompt))} className="group flex items-center gap-3 rounded-card border border-line bg-surface px-3.5 py-3 text-ui text-ink-soft transition-colors hover:border-line-strong hover:text-ink">
                    <PluginIcon name={s.icon} className="shrink-0 text-muted transition-colors group-hover:text-ink-soft" />
                    <span className="min-w-0 flex-1 text-left">{s.title}</span>
                    {s.file && <Paperclip size={14} strokeWidth={1.75} aria-label="Asks for a file" className="shrink-0 text-muted" />}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => {
            const live = !!requestId && i === messages.length - 1
            if (m.role === 'user') {
              return (
                <div key={m.id} className="flex flex-col items-end gap-1.5">
                  {m.attachments.length > 0 && <div className="flex flex-wrap justify-end gap-1.5">{m.attachments.map((a) => <AttachmentChip key={a.path} a={a} />)}</div>}
                  <div className="max-w-[85%] whitespace-pre-wrap [overflow-wrap:anywhere] rounded-[18px] bg-line/70 px-4 py-2.5 text-body"><UserText text={m.content} skills={skills} /></div>
                </div>
              )
            }
            return (
              <div key={m.id}>
                <WorkLog steps={m.steps} running={live} writing={!!m.content} thinking={live ? thoughtBuf : undefined} workedMs={m.workedMs} />
                {approval && i === messages.length - 1 && (
                  <ApprovalCard req={approval} onAnswer={(a) => { void hob.approval.answer(approval.id, a); setApproval(null) }} />
                )}
                <div data-testid="message-assistant" className="reply prose max-w-none [overflow-wrap:anywhere]">
                  {m.content && <Markdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>{tidyMarkdown(m.content)}</Markdown>}
                </div>
                <FileCards steps={m.steps} />
                {!live && (
                  <div className="mt-1.5 -ml-1.5 flex items-center gap-1">
                    {m.content && <CopyButton text={m.content.replace(/\n\n\*Stopped\.\*$/, '')} />}
                    {typeof m.id === 'number' && m.undoable && (m.undone
                      ? <span data-testid="undone" className="px-1.5 text-meta text-muted">{undoNotes[m.id as number] ?? 'Changes undone'}</span>
                      : <button data-testid="undo" onClick={() => void undoTask(m.id as number)} className="inline-flex items-center gap-1.5 rounded-control px-1.5 py-1 text-meta text-muted hover:bg-line/70 hover:text-ink"><Undo2 size={14} />Undo changes</button>)}
                    {i === offerAt && (
                      <span data-testid="skill-offer" className="inline-flex items-center">
                        <button data-testid="skill-offer-save" onClick={() => { closeOffer(); void send('Save what you just did as a skill, so I can run it again later.') }}
                          className="inline-flex items-center gap-1.5 rounded-control px-1.5 py-1 text-meta text-muted hover:bg-line/70 hover:text-ink"><Sparkles size={14} />Save as a skill</button>
                        <button data-testid="skill-offer-close" aria-label="Don't save as a skill" onClick={closeOffer} className="rounded-control p-1 text-muted hover:bg-line/70 hover:text-ink"><X size={12} /></button>
                      </span>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="relative mx-auto w-full max-w-[720px] px-6 pb-5">
        {/* text scrolls under a soft fade instead of being cut by the composer */}
        <div className="pointer-events-none absolute inset-x-0 -top-10 h-10 bg-gradient-to-b from-transparent to-paper" />
        {/* always rendered so it can fade in and out */}
        <button data-testid="jump-latest" aria-label="Jump to latest" aria-hidden={!showJump} tabIndex={showJump ? 0 : -1} onClick={jumpToLatest}
          className={`absolute -top-12 left-1/2 inline-flex size-9 -translate-x-1/2 items-center justify-center rounded-full border border-line-strong bg-surface text-ink-soft shadow-md transition-[opacity,transform] duration-200 ease-out hover:text-ink ${showJump ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-1 opacity-0'}`}>
          <ArrowDown size={16} strokeWidth={1.75} />
        </button>
        {dictation.error && (
          <p data-testid="dictation-error" className="mb-2 text-ui text-ink-soft">
            {dictation.error.text}{' '}
            {dictation.error.micSettings && <button onClick={() => void hob.speech.openMicSettings()} className="underline underline-offset-2 hover:text-ink">Open microphone settings</button>}
          </p>
        )}
        {notice && (
          <p data-testid="notice" className="mb-2 text-ui text-ink-soft">
            {notice.text} {notice.folders && <button onClick={() => { onNewProject(notice.folders); setNotice(null) }} className="underline underline-offset-2 hover:text-ink">Make a project</button>}
          </p>
        )}
        {queued && (
          <div data-testid="queued" className="fade-in mb-1.5 flex items-center gap-2 rounded-control bg-line/50 px-3 py-1.5 text-ui text-ink-soft">
            <Clock size={14} className="shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate">Sends when Hob is done: {queued}</span>
            <button aria-label="Don't send" title="Don't send" onClick={() => { setInput(queued); setQueued(null) }} className="text-muted hover:text-ink"><X size={14} /></button>
          </div>
        )}
        <div className="mb-1.5 flex min-h-7 items-center">
          <ProjectChip projects={projects} value={projectId} locked={created} onChange={pickProject} onNew={() => onNewProject()} />
        </div>
        <Composer
          value={input} onChange={setInput} onSend={() => void send()} onStop={stop} running={!!requestId}
          onAttach={() => void hob.files.pick().then(addFiles)}
          pending={pending} onRemovePending={(a) => setPending((p) => p.filter((x) => x.path !== a.path))}
          inputRef={inputRef} dictation={dictation} skills={skills}
        />
        <p className="mt-2 text-center text-meta text-muted">Hob can make mistakes.</p>
      </div>
    </main>
  )
}
