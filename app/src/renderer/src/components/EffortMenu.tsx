import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Gauge } from 'lucide-react'
import { hob } from '../api'
import { DEFAULT_EFFORT, EFFORTS, type Effort } from '../../../shared/effort'
import { t } from '../../../shared/i18n'

/** Beside the mic: how long Hob thinks before it answers. Kept in settings, for every chat. */
export function EffortMenu() {
  const [open, setOpen] = useState(false)
  const [effort, setEffort] = useState<Effort>(DEFAULT_EFFORT)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { void hob.settings.get().then((s) => setEffort(s.effort)) }, [])
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => { if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', close); window.addEventListener('keydown', close)
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', close) }
  }, [open])
  const pick = (e: Effort) => { setEffort(e); setOpen(false); void hob.settings.set({ effort: e }) }
  const current = EFFORTS.find((e) => e.id === effort) ?? EFFORTS[1]
  return (
    <div ref={box} className="relative">
      <button type="button" data-testid="effort" aria-label={t('Thinking: {effort}', { effort: t(current.label) })} title={t('How long Hob thinks before it answers')} aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="no-drag inline-flex h-8 items-center gap-1.5 rounded-control px-2 text-meta text-ink-soft transition-colors hover:bg-line/70 hover:text-ink">
        <Gauge size={14} strokeWidth={1.75} />{t(current.label)}<ChevronDown size={12} className="text-muted" />
      </button>
      {open && (
        <div data-testid="effort-options" role="menu" className="pop absolute bottom-full end-0 z-30 mb-2 w-64 rounded-card border border-line bg-surface p-1 shadow-lg">
          <p className="px-2.5 pt-1.5 pb-1 text-meta text-muted">{t('How long Hob thinks')}</p>
          {EFFORTS.map((e) => (
            <button key={e.id} role="menuitemradio" aria-checked={e.id === effort} data-testid="effort-option" onClick={() => pick(e.id)}
              className="flex w-full items-start gap-2 rounded-control px-2.5 py-1.5 text-start hover:bg-line/70">
              <span className="min-w-0 flex-1">
                <span className="block text-ui text-ink">{t(e.label)}</span>
                <span className="block text-meta text-muted">{t(e.description)}</span>
              </span>
              {e.id === effort && <Check size={14} className="mt-0.5 shrink-0 text-ink" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
