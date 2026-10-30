import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, Ellipsis, Pencil, Pin, PinOff, Trash2, type LucideIcon } from 'lucide-react'
import type { ChatSummary } from '../../../shared/agent'
import { shownTitle } from '../../../shared/replies'
import { t } from '../../../shared/i18n'
import { hob } from '../api'
import { button, Dialog, field } from './ui'

type Props = { chat: ChatSummary; onPin(): void; onRename(): void; onSave(): void; onDelete(): void }

/** The … beside a chat in the sidebar: pin, rename, save as Markdown, delete */
export function ChatMenu({ chat, onPin, onRename, onSave, onDelete }: Props) {
  const [at, setAt] = useState<{ top: number; left: number; up: boolean } | null>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!at) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !menu.current?.contains(e.target as Node) && !opener.current?.contains(e.target as Node)) setAt(null)
    }
    window.addEventListener('mousedown', close); window.addEventListener('keydown', close); window.addEventListener('blur', close)
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', close); window.removeEventListener('blur', close) }
  }, [at])
  // the sidebar scrolls and clips, so the menu sits over the page, below the … (above it near the bottom)
  const open = () => {
    const r = opener.current!.getBoundingClientRect()
    setAt({ top: r.bottom + 4, left: document.dir === 'rtl' ? r.right : r.left, up: r.bottom + 190 > window.innerHeight })
  }
  useLayoutEffect(() => {
    if (!at || !menu.current) return
    const m = menu.current.getBoundingClientRect()
    const r = opener.current!.getBoundingClientRect()
    if (at.up) menu.current.style.top = `${r.top - 4 - m.height}px`
    if (document.dir === 'rtl') menu.current.style.left = `${r.right - m.width}px`
  }, [at])
  const item = (icon: LucideIcon, label: string, run: () => void, testId: string, danger = false) => {
    const Icon = icon
    return (
      <button role="menuitem" data-testid={testId} onClick={() => { setAt(null); run() }}
        className={`flex w-full items-center gap-2.5 rounded-control px-2.5 py-1.5 text-start text-ui hover:bg-line/70 ${danger ? 'text-danger' : 'text-ink'}`}>
        <Icon size={15} strokeWidth={1.75} />{label}
      </button>
    )
  }
  return (
    <>
      <button ref={opener} data-testid="chat-menu" aria-label={t('More for “{title}”', { title: shownTitle(chat.title) })} title={t('More')} aria-haspopup="menu" aria-expanded={!!at}
        onClick={() => (at ? setAt(null) : open())}
        className={`text-muted hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 ${at ? 'opacity-100' : 'opacity-0'}`}>
        <Ellipsis size={16} />
      </button>
      {at && createPortal(
        <div ref={menu} role="menu" data-testid="chat-menu-items" style={{ top: at.top, left: at.left }}
          className="pop fixed z-40 w-52 rounded-card border border-line bg-surface p-1 shadow-lg">
          {chat.pinned ? item(PinOff, t('Unpin'), onPin, 'chat-pin') : item(Pin, t('Pin'), onPin, 'chat-pin')}
          {item(Pencil, t('Rename'), onRename, 'chat-rename')}
          {item(Download, t('Save as Markdown'), onSave, 'chat-save')}
          <div className="my-1 border-t border-line" />
          {item(Trash2, t('Delete'), onDelete, 'chat-delete', true)}
        </div>,
        document.body,
      )}
    </>
  )
}

/** Rename a chat: the name is selected, so typing replaces it */
export function RenameDialog({ chat, onClose }: { chat: ChatSummary; onClose(): void }) {
  const [name, setName] = useState(shownTitle(chat.title))
  const input = useRef<HTMLInputElement>(null)
  // after the dialog opens: opening it focuses its first button
  useEffect(() => { input.current?.select() }, [])
  const save = async () => {
    if (name.trim() && name.trim() !== shownTitle(chat.title)) await hob.chats.rename(chat.id, name)
    onClose()
  }
  return (
    <Dialog title={t('Rename chat')} onClose={onClose} testId="rename-dialog" className="max-w-md">
      <form onSubmit={(e) => { e.preventDefault(); void save() }}>
        <input ref={input} data-testid="rename-input" aria-label={t('Name')} value={name}
          onChange={(e) => setName(e.target.value)} className={field} />
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className={button.quiet} onClick={onClose}>{t('Cancel')}</button>
          <button type="submit" data-testid="rename-save" disabled={!name.trim()} className={button.primary}>{t('Save')}</button>
        </div>
      </form>
    </Dialog>
  )
}
