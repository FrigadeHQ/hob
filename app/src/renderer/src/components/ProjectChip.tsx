import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Folder, FolderPlus, MessageSquare, type LucideIcon } from 'lucide-react'
import type { Project } from '../../../shared/agent'

type Props = {
  projects: Project[]
  value: string | null
  /** the chat exists: its project can't change */
  locked: boolean
  onChange(id: string | null): void
  onNew(): void
}

const chip = 'inline-flex items-center gap-1.5 rounded-control px-2 py-1 text-meta text-ink-soft'

/** Which project a chat is in. A menu while the chat is new; a plain label after. */
export function ProjectChip({ projects, value, locked, onChange, onNew }: Props) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  const current = projects.find((p) => p.id === value)
  // a chat that started can't move: it shows its project, and nothing when it has none
  // (the row keeps its height, so the message box doesn't jump between chats)
  if (locked) return current ? <span data-testid="project-chip" className={`${chip} cursor-default`}><Folder size={14} strokeWidth={1.75} />{current.name}</span> : null
  const Icon = current ? Folder : FolderPlus
  const choose = (id: string | null) => { onChange(id); setOpen(false) }
  return (
    <div ref={box} className="relative">
      <button data-testid="project-chip" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={`${chip} transition-colors hover:bg-line/70 hover:text-ink`}>
        <Icon size={14} strokeWidth={1.75} />{current?.name ?? 'Add to project'}<ChevronDown size={12} />
      </button>
      {open && (
        <div data-testid="project-menu" role="menu" className="fade-in absolute bottom-full left-0 z-30 mb-1 max-h-72 w-64 overflow-y-auto rounded-card border border-line bg-surface p-1 shadow-lg">
          {projects.map((p) => <Item key={p.id} icon={Folder} label={p.name} on={p.id === value} onClick={() => choose(p.id)} />)}
          {current && <Item icon={MessageSquare} label="Not in a project" onClick={() => choose(null)} />}
          <Item icon={FolderPlus} label="New project…" onClick={() => { setOpen(false); onNew() }} />
        </div>
      )}
    </div>
  )
}

function Item({ icon: Icon, label, on, onClick }: { icon: LucideIcon; label: string; on?: boolean; onClick(): void }) {
  return (
    <button role="menuitem" data-testid="project-option" onClick={onClick} className="flex w-full items-center gap-2 rounded-control px-2.5 py-1.5 text-left text-ui hover:bg-line/70">
      <Icon size={14} strokeWidth={1.75} className="shrink-0 text-ink-soft" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {on && <Check size={14} className="shrink-0 text-ink-soft" />}
    </button>
  )
}
