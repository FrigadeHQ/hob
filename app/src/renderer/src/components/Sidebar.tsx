import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Folder, FolderOpen, FolderPlus, Hand, LoaderCircle, Pencil, Plus, Puzzle, Settings, SquarePen, X } from 'lucide-react'
import type { ChatSummary, LiveSummary, Project } from '../../../shared/agent'
import { fileManager } from '../../../shared/platform'
import type { SetupState } from '../../../shared/types'
import type { Screen } from '../App'
import { hob } from '../api'
import { Status } from './Status'
import { confirmAction } from './Confirm'
import { IconButton } from './ui'

const DAY = 86_400_000
function group(chats: ChatSummary[]) {
  const start = new Date().setHours(0, 0, 0, 0)
  const g: [string, ChatSummary[]][] = [['Today', []], ['Yesterday', []], ['Earlier', []]]
  for (const c of chats) g[c.updatedAt >= start ? 0 : c.updatedAt >= start - DAY ? 1 : 2][1].push(c)
  return g.filter(([, list]) => list.length)
}

type Props = {
  state: SetupState
  selected: string | null
  refreshKey: number
  screen: Screen
  /** a new chat waiting to start in this project */
  draftProject: string | null
  onSelect(id: string): void
  onNew(): void
  onNewInProject(id: string): void
  /** null: create a new one */
  onEditProject(p: Project | null): void
  onSettings(): void
}

const WIDTH = { min: 200, max: 420, normal: 256 }
const KEY = 'hob.sidebarWidth'
const clamp = (w: number) => Math.round(Math.min(WIDTH.max, Math.max(WIDTH.min, w)))

/** sidebar width the user dragged to, remembered on this computer */
function useWidth() {
  const [width, setWidth] = useState(() => {
    try { const w = Number(localStorage.getItem(KEY)); return w ? clamp(w) : WIDTH.normal } catch { return WIDTH.normal }
  })
  const save = (w: number) => { setWidth(w); try { localStorage.setItem(KEY, String(w)) } catch { /* not remembered */ } }
  return [width, save] as const
}

const COLLAPSED = 'hob.collapsedProjects'
/** projects whose chats the user folded away, remembered on this computer */
function useCollapsed() {
  const [ids, setIds] = useState<string[]>(() => {
    try { const v = JSON.parse(localStorage.getItem(COLLAPSED) ?? '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
  })
  const toggle = (id: string) => {
    const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
    setIds(next)
    try { localStorage.setItem(COLLAPSED, JSON.stringify(next)) } catch { /* not remembered */ }
  }
  return [ids, toggle] as const
}

const row = 'group mb-px flex h-8 items-center gap-2 rounded-control px-2 text-ui'
const label = 'px-2 pb-1 pt-4 text-meta text-muted'
/** the + next to a heading: shows when the heading is hovered (or focused from the keyboard) */
const headAction = 'mt-3 rounded-control p-1 text-muted opacity-0 transition-opacity hover:bg-line/70 hover:text-ink focus-visible:opacity-100 group-hover/head:opacity-100'

export function Sidebar({ state, selected, refreshKey, screen, draftProject, onSelect, onNew, onNewInProject, onEditProject, onSettings }: Props) {
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  // chats whose reply is still being written, maybe while another chat is open
  const [live, setLive] = useState<LiveSummary[]>([])
  useEffect(() => { void hob.chat.live().then(setLive); return hob.chat.onLive(setLive) }, [])
  const [collapsed, toggle] = useCollapsed()
  const [width, setWidth] = useWidth()
  const [resizing, setResizing] = useState(false)
  const drag = useRef<{ x: number; w: number } | null>(null)
  const reload = () => { void hob.chats.list().then(setChats); void hob.projects.list().then(setProjects) }
  useEffect(reload, [refreshKey])
  useEffect(() => hob.chats.onChanged(reload), [])

  async function remove(c: ChatSummary) {
    if (!await confirmAction({ title: `Delete “${c.title}”?`, body: 'The chat is removed from Hob. Files you added to it, or that Hob made in it, move to the Trash.', ok: 'Delete chat', danger: true })) return
    await hob.chats.remove(c.id)
    if (c.id === selected) onNew()
    reload()
  }

  const fm = fileManager(hob.platform)
  const chatRow = (c: ChatSummary, inProject: boolean) => (
    <div key={c.id} className={`${row} ${inProject ? 'pl-8' : ''} ${c.id === selected && screen === 'chat' ? 'bg-selection text-ink' : 'text-ink-soft hover:bg-line/60 hover:text-ink'}`}>
      <button data-testid="chat-item" onClick={() => onSelect(c.id)} className="min-w-0 flex-1 truncate text-left">{c.title}</button>
      {(() => {
        const l = live.find((x) => x.chatId === c.id)
        if (!l) return null
        return l.waiting
          ? <span data-testid="chat-waiting" title="Waiting for your OK" className="text-accent"><Hand size={14} /></span>
          : <span data-testid="chat-working" title="Working" className="text-muted"><LoaderCircle size={14} className="animate-spin" /></span>
      })()}
      <button aria-label="Delete chat" title="Delete chat" onClick={() => void remove(c)} className="text-muted opacity-0 hover:text-ink group-hover:opacity-100"><X size={14} /></button>
    </div>
  )

  return (
    <aside data-testid="sidebar" style={{ width }} className="relative flex shrink-0 flex-col border-r border-line bg-sidebar">
      <div className="drag h-12 shrink-0" />
      <div className="space-y-0.5 px-2">
        <button data-testid="new-chat" onClick={onNew} className={`no-drag w-full ${row} font-medium ${!selected && !draftProject && screen === 'chat' ? 'bg-selection' : 'hover:bg-line/70'}`}>
          <SquarePen size={16} strokeWidth={1.75} className="text-ink-soft" />New chat
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        <div className="group/head flex items-center justify-between">
          <p className={label}>Projects</p>
          <button data-testid="new-project" aria-label="New project" title="New project" onClick={() => onEditProject(null)} className={headAction}><Plus size={14} /></button>
        </div>
        {projects.length === 0 && (
          <button onClick={() => onEditProject(null)} className={`w-full ${row} text-muted hover:bg-line/60 hover:text-ink`}>
            <FolderPlus size={16} strokeWidth={1.75} />New project
          </button>
        )}
        {projects.map((p) => {
          const list = chats.filter((c) => c.projectId === p.id)
          const open = !collapsed.includes(p.id)
          const here = screen === 'chat' && selected === null && draftProject === p.id
          return (
            <div key={p.id} data-testid="project-item">
              <div className={`${row} ${here ? 'bg-selection text-ink' : 'text-ink-soft hover:bg-line/60 hover:text-ink'}`} title={p.folders[0]}>
                <button aria-label={open ? `Hide chats in ${p.name}` : `Show chats in ${p.name}`} onClick={() => toggle(p.id)} className="shrink-0 text-ink-soft hover:text-ink">
                  {open ? <FolderOpen size={16} strokeWidth={1.75} /> : <Folder size={16} strokeWidth={1.75} />}
                </button>
                <button data-testid="project-open" onClick={() => onNewInProject(p.id)} className="min-w-0 flex-1 truncate text-left">{p.name}</button>
                {p.folders.length > 0 && (
                  <button data-testid="project-reveal" aria-label={`Open in ${fm}`} title={`Open in ${fm}`} onClick={() => void hob.projects.open(p.id)} className="text-muted opacity-0 hover:text-ink group-hover:opacity-100"><ExternalLink size={14} /></button>
                )}
                <button data-testid="project-edit" aria-label="Edit project" title="Edit project" onClick={() => onEditProject(p)} className="text-muted opacity-0 hover:text-ink group-hover:opacity-100"><Pencil size={14} /></button>
              </div>
              {open && (list.length ? list.map((c) => chatRow(c, true)) : <p className="py-1 pl-8 text-meta text-muted">No chats</p>)}
            </div>
          )
        })}
        {group(chats.filter((c) => !c.projectId)).map(([name, list], i) => (
          <div key={name}>
            {i === 0
              ? (
                <div className="group/head flex items-center justify-between">
                  <p className={label}>{name}</p>
                  <button data-testid="new-chat-inline" aria-label="New chat" title="New chat" onClick={onNew} className={headAction}><Plus size={14} /></button>
                </div>
              )
              : <p className={label}>{name}</p>}
            {list.map((c) => chatRow(c, false))}
          </div>
        ))}
      </nav>
      <div className="flex items-center justify-between gap-2 border-t border-line py-2.5 pl-4 pr-3">
        <Status state={state} working={live.some((c) => c.chatId === selected && !c.waiting)} />
        <IconButton icon={Settings} label="Settings" testId="open-settings" onClick={onSettings} />
      </div>
      {/* drag the edge to resize; double-click puts it back. Last in the sidebar so it wins over the window-drag strip */}
      <div
        data-testid="sidebar-resize" role="separator" aria-orientation="vertical" aria-label="Resize sidebar" title="Drag to resize"
        onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, w: width }; setResizing(true) }}
        onPointerMove={(e) => { if (drag.current) setWidth(clamp(drag.current.w + e.clientX - drag.current.x)) }}
        onPointerUp={() => { drag.current = null; setResizing(false) }}
        onDoubleClick={() => setWidth(WIDTH.normal)}
        className={`no-drag absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize transition-colors ${resizing ? 'bg-line-strong/60' : 'hover:bg-line-strong/40'}`}
      />
    </aside>
  )
}
