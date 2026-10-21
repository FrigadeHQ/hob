import { useEffect, useState } from 'react'
import { CornerDownLeft, FileText, Image as ImageIcon, Mic, Plus, Square, X } from 'lucide-react'
import { canPreview, previewFile } from './Preview'
import { MicMenu } from './MicMenu'
import { PdfThumb } from './PdfView'
import { mabel } from '../api'
import type { Attachment } from '../../../shared/agent'
import type { SkillRef } from '../../../shared/plugins'
import { IconButton, PluginIcon } from './ui'

const size = (b: number) => (b < 1e6 ? `${Math.max(1, Math.round(b / 1e3))} KB` : `${(b / 1e6).toFixed(1)} MB`)

const THUMB_IMAGE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i

export function AttachmentChip({ a, onRemove }: { a: Attachment; onRemove?: () => void }) {
  const image = /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i.test(a.name)
  const pdf = /\.pdf$/i.test(a.path)
  const remove = onRemove && (
    <button aria-label={`Remove ${a.name}`} onClick={onRemove}
      className="absolute -right-2 -top-2 z-10 grid h-6 w-6 place-items-center rounded-full bg-ink text-paper opacity-0 shadow transition-opacity focus-visible:opacity-100 group-hover:opacity-100">
      <X size={13} strokeWidth={2.25} />
    </button>
  )
  // photos and PDFs: a small picture of them; click for the full preview
  if (THUMB_IMAGE.test(a.path) || pdf) {
    return (
      <span data-testid="attachment-chip" className="group relative inline-block">
        <button data-testid="attachment-open" title={`Preview ${a.name}`} onClick={() => previewFile(a.path)}
          className="flex h-[104px] w-32 flex-col overflow-hidden rounded-card border border-line bg-surface text-left transition-colors hover:border-line-strong">
          {pdf ? (
            <>
              <span className="block min-h-0 flex-1 overflow-hidden border-b border-line"><PdfThumb path={a.path} width={128} /></span>
              <span className="flex items-center gap-1.5 px-2 py-1.5 text-meta">
                <FileText size={13} strokeWidth={1.75} className="shrink-0 text-ink-soft" />
                <span className="min-w-0 truncate">{a.name}</span>
              </span>
            </>
          ) : (
            <><img data-testid="attachment-thumb-image" src={mabel.fileUrl(a.path)} alt="" className="block h-full w-full object-cover" /><span className="sr-only">{a.name}</span></>
          )}
        </button>
        {remove}
      </span>
    )
  }
  const Icon = image ? ImageIcon : FileText
  return (
    <span data-testid="attachment-chip" className="group relative inline-flex items-center gap-1.5 rounded-control border border-line bg-surface px-2 py-1 text-ui">
      {/* click to look at it: photos and PDFs in Mabel, anything else in its own app */}
      <button data-testid="attachment-open" title={canPreview(a.path) ? 'Preview' : 'Open'} onClick={() => previewFile(a.path)} className="inline-flex min-w-0 items-center gap-1.5 hover:text-ink">
        <Icon size={14} strokeWidth={1.75} className="shrink-0 text-ink-soft" />
        <span className="max-w-48 truncate underline-offset-2 hover:underline">{a.name}</span>
      </button>
      <span className="text-meta text-muted">{size(a.sizeBytes)}</span>
      {remove}
    </span>
  )
}

type Props = {
  value: string
  onChange(v: string): void
  onSend(): void
  onStop(): void
  onAttach(): void
  /** images or files pasted into the message box (a screenshot from the clipboard) */
  onPasteFiles?(files: File[]): void
  running: boolean
  pending: Attachment[]
  onRemovePending(a: Attachment): void
  inputRef: React.RefObject<HTMLTextAreaElement | null>
  /** absent until dictation is available */
  dictation?: { listening: boolean; busy: boolean; hint?: string; toggle(): void; cancel(): void; level(): number }
  /** typing / at the start lists these */
  skills?: SkillRef[]
}

/** "/pla" → skills starting with "pla"; null when the box isn't a bare /command */
function matches(value: string, skills: SkillRef[]): SkillRef[] | null {
  const m = /^\/([a-z0-9-]*)$/.exec(value)
  if (!m || !skills.length) return null
  const q = m[1]
  return skills.filter((s) => s.name.startsWith(q)).concat(skills.filter((s) => !s.name.startsWith(q) && s.name.includes(q)))
}

function SkillMenu({ items, active, onPick, onHover }: { items: SkillRef[]; active: number; onPick(s: SkillRef): void; onHover(i: number): void }) {
  return (
    <div data-testid="skill-menu" role="listbox" className="fade-in absolute inset-x-0 bottom-full z-30 mb-2 max-h-72 overflow-y-auto rounded-card border border-line bg-surface p-1 shadow-lg">
      <p className="px-2.5 pt-1.5 pb-1 text-meta text-muted">Skills</p>
      {items.length === 0 && <p className="px-2.5 py-2 text-ui text-muted">No skill with that name</p>}
      {items.map((s, i) => (
        <button key={s.name} role="option" aria-selected={i === active} data-testid="skill-option"
          onMouseDown={(e) => { e.preventDefault(); onPick(s) }} onMouseEnter={() => onHover(i)}
          className={`flex w-full items-center gap-2.5 rounded-control px-2.5 py-1.5 text-left ${i === active ? 'bg-line/70' : ''}`}>
          <PluginIcon name={s.icon} className="shrink-0 text-ink-soft" />
          <span className="shrink-0 text-ui font-medium">/{s.name}</span>
          <span className="min-w-0 flex-1 truncate text-ui text-muted">{s.description}</span>
          <span className="shrink-0 text-meta text-muted">{s.pluginName}</span>
        </button>
      ))}
    </div>
  )
}

const BARS = 28

/** Live bars that scroll right to left with the mic's loudness; quiet moments are dots. */
function Waveform({ level }: { level(): number }) {
  const [bars, setBars] = useState<number[]>(() => Array(BARS).fill(0))
  useEffect(() => {
    let last = 0
    let raf = 0
    const tick = (t: number) => {
      // a new bar about every 70 ms: fast enough to feel live, slow enough to read
      if (t - last > 70) { last = t; const v = level(); setBars((b) => [...b.slice(1), v]) }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [level])
  return (
    <div data-testid="dictation-wave" aria-hidden className="flex h-6 items-center gap-[3px] px-2">
      {bars.map((v, i) => (
        <span key={i} className="w-[3px] rounded-full bg-ink-soft transition-[height] duration-75" style={{ height: `${Math.max(3, Math.round(v * 22))}px`, opacity: 0.35 + 0.65 * Math.min(1, (i + 4) / BARS) }} />
      ))}
    </div>
  )
}

/** The message box: text on top, tools along the bottom, Enter sends. */
export function Composer({ value, onChange, onSend, onStop, onAttach, onPasteFiles, running, pending, onRemovePending, inputRef, dictation, skills = [] }: Props) {
  const canSend = !!value.trim() && !running
  const [active, setActive] = useState(0)
  /** Esc hides the menu until the text changes */
  const [dismissed, setDismissed] = useState<string | null>(null)
  const items = dismissed === value ? null : matches(value, skills)
  const pick = (sk: SkillRef) => { onChange(`/${sk.name} `); setActive(0); inputRef.current?.focus() }
  const listening = !!dictation?.listening
  // while recording: Enter adds the text, Esc throws the recording away (wherever the focus is)
  useEffect(() => {
    if (!listening) return
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); dictation?.cancel() }
      else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); dictation?.toggle() }
    }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [listening, dictation])
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (listening) return
    if (items) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % Math.max(1, items.length)); return }
      if ((e.key === 'Enter' || e.key === 'Tab') && items[active] && !e.shiftKey) { e.preventDefault(); pick(items[active]); return }
      if (e.key === 'Escape') { e.preventDefault(); setDismissed(value); return }
    }
    // while Mabel works, Enter queues the message (the chat sends it when the reply is done)
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (value.trim()) onSend() }
  }
  return (
    <div className="relative">
      {items && <SkillMenu items={items} active={Math.min(active, items.length - 1)} onPick={pick} onHover={setActive} />}
      <div className="rounded-composer border border-line-strong bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.04)] transition-colors focus-within:border-muted">
        {pending.length > 0 && (
          <div className="flex flex-wrap items-end gap-2.5 px-3 pt-3">{pending.map((a) => <AttachmentChip key={a.path} a={a} onRemove={() => onRemovePending(a)} />)}</div>
        )}
        <textarea
          ref={inputRef}
          autoFocus
          data-testid="composer-input"
          value={value}
          onChange={(e) => { onChange(e.target.value); setActive(0) }}
          onKeyDown={onKeyDown}
          // a pasted screenshot or copied file becomes an attachment; pasted text stays text
          onPaste={(e) => { const files = Array.from(e.clipboardData.files); if (files.length && onPasteFiles) { e.preventDefault(); onPasteFiles(files) } }}
          placeholder={dictation?.hint ?? (running ? 'Mabel is working. Type your next message, it sends when Mabel is done' : skills.length ? 'Ask Mabel anything, type / for skills' : 'Ask Mabel anything, or drop files here')}
          rows={1}
          className={`block max-h-60 min-h-[48px] w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-body outline-none placeholder:text-muted [field-sizing:content] ${dictation?.hint ? 'placeholder:italic' : ''}`}
        />
        <div className="flex items-center gap-0.5 px-2 pb-2">
          <IconButton icon={Plus} label="Add files" testId="attach" onClick={onAttach} />
          <div className="flex-1" />
          {/* same buttons while recording: the wave appears next to the mic, which turns blue */}
          {dictation?.listening && <Waveform level={dictation.level} />}
          {dictation?.busy && (
            <span data-testid="dictate-busy" className="flex items-center gap-1 px-2" aria-label="Turning speech into text">
              {[0, 1, 2].map((i) => <span key={i} className="size-1.5 animate-pulse rounded-full bg-ink-soft" style={{ animationDelay: `${i * 160}ms` }} />)}
            </span>
          )}
          {dictation && (
            <button type="button" data-testid="dictate" aria-label={dictation.listening ? 'Stop and add the text (Enter)' : 'Dictate'} title={dictation.listening ? 'Stop and add the text (Enter). Esc cancels.' : 'Dictate'}
              onClick={dictation.toggle} disabled={dictation.busy}
              className={`no-drag inline-flex size-8 items-center justify-center rounded-control transition-colors disabled:opacity-40 ${dictation.listening ? 'bg-rec text-rec-ink' : 'text-ink-soft hover:bg-line/70 hover:text-ink'}`}>
              <Mic size={16} strokeWidth={1.75} />
            </button>
          )}
          {dictation && <MicMenu disabled={dictation.listening || dictation.busy} />}
          {running ? (
            <button data-testid="composer-stop" aria-label="Stop" title="Stop" onClick={onStop} className="inline-flex size-8 items-center justify-center rounded-full bg-ink text-paper hover:opacity-90">
              <Square size={12} fill="currentColor" />
            </button>
          ) : (
            <button
              data-testid="composer-send" aria-label="Send (Enter)" title="Send (Enter)" onClick={onSend} disabled={!canSend}
              className="inline-flex size-8 items-center justify-center rounded-control text-muted transition-colors enabled:text-ink enabled:hover:bg-line/70 disabled:opacity-60"
            >
              <CornerDownLeft size={16} strokeWidth={1.75} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
