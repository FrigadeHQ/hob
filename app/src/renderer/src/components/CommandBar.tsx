import { useEffect, useMemo, useRef, useState } from 'react'
import { shownTitle } from '../../../shared/replies'
import { Folder, FolderPlus, MessageSquare, Puzzle, Settings, SquarePen, type LucideIcon } from 'lucide-react'
import type { ChatSummary, Project } from '../../../shared/agent'
import { hob } from '../api'
import { language, t } from '../../../shared/i18n'

export const MOD = hob.platform === 'darwin' ? '⌘' : 'Ctrl+'

export type Action = { id: string; label: string; icon: LucideIcon; keys?: string; run(): void }
type Item = { key: string; section: string; label: string; icon?: LucideIcon; hint?: string; snippet?: string; run(): void }

type Props = {
  onClose(): void
  onOpenChat(id: string): void
  onNew(): void
  onNewInProject(id: string): void
  onNewProject(): void
  onPlugins(): void
  onSettings(): void
}

/** ⌘K: find a chat by its title or by anything said in it, or run a quick action. */
export function CommandBar({ onClose, onOpenChat, onNew, onNewInProject, onNewProject, onPlugins, onSettings }: Props) {
  const [query, setQuery] = useState('')
  const [recent, setRecent] = useState<ChatSummary[]>([])
  const [found, setFound] = useState<(ChatSummary & { snippet?: string })[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [active, setActive] = useState(0)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => { void hob.chats.list().then((c) => setRecent(c.slice(0, 5))); void hob.projects.list().then(setProjects) }, [])
  useEffect(() => {
    if (!query.trim()) { setFound([]); return }
    // a short pause so each keystroke doesn't search
    const t = setTimeout(() => void hob.chats.search(query).then(setFound), 80)
    return () => clearTimeout(t)
  }, [query])

  const actions: Action[] = useMemo(() => [
    { id: 'new', label: t('New chat'), icon: SquarePen, keys: `${MOD}N`, run: onNew },
    { id: 'plugins', label: t('Skills, connectors and plugins'), icon: Puzzle, run: onPlugins },
    { id: 'project', label: t('New project'), icon: FolderPlus, run: onNewProject },
    { id: 'settings', label: t('Settings'), icon: Settings, keys: `${MOD},`, run: onSettings },
  ], [onNew, onNewProject, onPlugins, onSettings, language()]) // new labels in a newly picked language

  const items: Item[] = useMemo(() => {
    const q = query.trim().toLowerCase()
    const chats: (ChatSummary & { snippet?: string })[] = q ? found : recent
    const acts = q ? actions.filter((a) => a.label.toLowerCase().includes(q)) : actions
    const projs = q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : projects.slice(0, 5)
    return [
      ...chats.map((c) => ({ key: `c:${c.id}`, section: q ? t('Chats') : t('Recent chats'), label: shownTitle(c.title), icon: MessageSquare, snippet: c.snippet, run: () => onOpenChat(c.id) })),
      ...projs.map((p) => ({ key: `p:${p.id}`, section: t('Projects'), label: p.name, icon: Folder, hint: t('New chat'), run: () => onNewInProject(p.id) })),
      ...acts.map((a) => ({ key: `a:${a.id}`, section: t('Quick actions'), label: a.label, icon: a.icon, hint: a.keys, run: a.run })),
    ]
  }, [query, found, recent, projects, actions, onOpenChat, onNewInProject])

  useEffect(() => setActive(0), [query])
  useEffect(() => { list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }) }, [active])

  const pick = (i: Item) => { onClose(); i.run() }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
    else if (e.key === 'Enter' && items[active]) { e.preventDefault(); pick(items[active]) }
  }

  return (
    <div data-scrim className="scrim fade-in fixed inset-0 z-50 flex justify-center px-4 pt-[14vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div data-testid="command-bar" role="dialog" aria-label={t('Search')} className="no-drag flex max-h-[60vh] w-full max-w-xl flex-col overflow-hidden rounded-[14px] border border-line bg-surface shadow-2xl">
        <input
          autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey}
          placeholder={t('Search chats and projects, or run a command')} aria-label={t('Search chats and projects, or run a command')}
          className="w-full border-b border-line bg-transparent px-4 py-3 text-body outline-none placeholder:text-muted"
        />
        <div ref={list} className="overflow-y-auto p-1.5">
          {items.length === 0 && <p className="px-3 py-6 text-center text-ui text-muted">{t('Nothing found for “{query}”', { query: query.trim() })}</p>}
          {items.map((it, i) => (
            <div key={it.key}>
              {(i === 0 || items[i - 1].section !== it.section) && <p className="px-2.5 pb-1 pt-2.5 text-meta text-muted">{it.section}</p>}
              <button
                type="button" data-testid="command-item" data-active={i === active}
                onMouseMove={() => setActive(i)} onClick={() => pick(it)}
                className={`flex w-full items-center gap-2.5 rounded-control px-2.5 py-1.5 text-start text-ui ${i === active ? 'bg-line/70 text-ink' : 'text-ink-soft'}`}
              >
                {it.icon && <it.icon size={16} strokeWidth={1.75} className="shrink-0 text-ink-soft" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{it.label}</span>
                  {it.snippet && <span className="block truncate text-meta text-muted">{it.snippet}</span>}
                </span>
                {it.hint && <kbd className="shrink-0 font-sans text-meta text-muted">{it.hint}</kbd>}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
