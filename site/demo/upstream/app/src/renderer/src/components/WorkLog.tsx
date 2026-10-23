import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Ban, Check, ChevronRight, Hand, LoaderCircle, RefreshCw } from 'lucide-react'
import type { Step } from '../../../shared/agent'
import { thinkingPreview } from '../../../shared/thinking'
import { stepRows, type StepRow as Row } from '../../../shared/steps'

const STATUS_ICON: Record<Row['status'], React.ReactNode> = {
  running: <LoaderCircle size={14} className="animate-spin" />,
  waiting: <Hand size={14} />,
  done: <Check size={14} />,
  error: <AlertCircle size={14} className="text-accent" />,
  denied: <Ban size={14} />,
  // an attempt that didn't work while Hob is still on it: normal, not an error
  retrying: <RefreshCw size={13} />,
}

/** How often the live thinking line may change: slow enough to read. */
export const THINKING_REFRESH_MS = 1500

const duration = (ms: number) => {
  const s = Math.max(1, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

function StepRow({ s }: { s: Row }) {
  const [open, setOpen] = useState(false)
  return (
    <li data-testid="step" data-status={s.status}>
      <button disabled={!s.detail} onClick={() => setOpen((o) => !o)} className="group flex items-center gap-2 text-left text-ui text-ink-soft enabled:hover:text-ink">
        <span className="flex w-4 shrink-0 justify-center text-muted">{STATUS_ICON[s.status]}</span>
        <span>{s.title}</span>
        {s.tries > 1 && <span data-testid="step-tries" className="text-meta text-muted">{s.tries} tries</span>}
        {s.detail && <ChevronRight size={14} className={`text-muted transition-transform ${open ? 'rotate-90' : ''}`} />}
      </button>
      {/* while retrying, the error itself isn't news: it only shows if nothing ends up working */}
      {s.status === 'retrying' ? <p data-testid="step-reason" className="ml-6 text-meta text-muted">Trying another way…</p>
        : s.reason && (s.status === 'error' || s.status === 'denied') && (
        <p data-testid="step-reason" className="ml-6 text-meta text-muted">{s.reason}</p>
      )}
      {open && s.detail && (
        <pre data-testid="step-detail" className="mt-1.5 ml-6 max-h-72 overflow-auto rounded-card border border-line bg-sidebar p-3 font-mono text-meta whitespace-pre-wrap text-ink-soft">{s.detail}</pre>
      )}
    </li>
  )
}

/** One calm line of the model's reasoning; changes at most every THINKING_REFRESH_MS. */
/** quick replies ("hey, how's it going") just say Thinking: their reasoning is noise */
export const THINKING_SHOW_AFTER_MS = 3000

function ThinkingLine({ source }: { source: React.MutableRefObject<string> }) {
  const [line, setLine] = useState('')
  const since = useRef(Date.now())
  useEffect(() => {
    const tick = () => setLine((cur) => { if (Date.now() - since.current < THINKING_SHOW_AFTER_MS) return cur; const next = thinkingPreview(source.current); return next || cur })
    tick()
    const t = setInterval(tick, THINKING_REFRESH_MS)
    return () => clearInterval(t)
  }, [source])
  if (!line) return null
  return <p key={line} data-testid="thinking-preview" className="fade-in mt-1 ml-6 line-clamp-2 text-ui text-muted">{line}</p>
}

/** a plain reply that hasn't started yet: shown where its text will appear, so nothing jumps when it does */
export function ThinkingIndicator({ thinking }: { thinking?: React.MutableRefObject<string> }) {
  return (
    <div data-testid="thinking">
      <div className="flex items-center gap-2 text-ui text-ink-soft">
        <span className="flex w-4 justify-center text-muted"><LoaderCircle size={14} className="animate-spin" /></span>
        <span className="animate-pulse">Thinking</span>
      </div>
      {thinking && <ThinkingLine source={thinking} />}
    </div>
  )
}

/** folds open and shut smoothly instead of snapping */
function Fold({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}

/**
 * The agent's work for one reply. While running: what it's doing now, plus the steps so far.
 * When done: the steps fold away under a single "Worked for 12s" line that opens them again.
 */
export function WorkLog({ steps, running, writing, thinking, workedMs }: {
  steps: Step[]
  /** the whole turn is still going (the model may write text between steps) */
  running: boolean
  /** reply text has started */
  writing?: boolean
  thinking?: React.MutableRefObject<string>
  workedMs?: number
}) {
  // a reply that just finished starts open and folds shut, so the text below slides up instead of jumping
  const [open, setOpen] = useState(running)
  const wasRunning = useRef(running)
  useEffect(() => {
    if (wasRunning.current && !running) {
      setOpen(true)
      const t = setTimeout(() => setOpen(false), 600)
      wasRunning.current = false
      return () => clearTimeout(t)
    }
    wasRunning.current = running
  }, [running])
  const startedAt = useRef(Date.now())
  // plain replies without tools: the Thinking indicator sits in the reply itself
  if (!steps.length) return null

  if (running) {
    const current = [...steps].reverse().find((s) => s.status === 'running' || s.status === 'waiting')
    const shown = steps.filter((s) => s !== current)
    return (
      <div data-testid="worklog" className="mb-3">
        <div className="flex items-center gap-2 text-ui text-ink-soft">
          <span className="flex w-4 justify-center text-muted"><LoaderCircle size={14} className="animate-spin" /></span>
          <span className="animate-pulse">{current?.status === 'waiting' ? 'Waiting for your OK' : current ? current.title : writing ? 'Working' : 'Thinking'}</span>
        </div>
        {/* the latest thought stays while steps run, so what Hob is up to never vanishes */}
        {!writing && thinking && <ThinkingLine source={thinking} />}
        {/* the step waiting for an answer is the approval card below; the running one is the line above */}
        {shown.length > 0 && <ul className="mt-2 space-y-1 border-l border-line pl-3 ml-2">{stepRows(shown, true).map((s) => <StepRow key={s.id} s={s} />)}</ul>}
      </div>
    )
  }

  const label = `Worked for ${duration(workedMs ?? Date.now() - startedAt.current)}`
  return (
    <div data-testid="worklog" className="mb-3">
      <button data-testid="worklog-toggle" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-ui text-muted hover:text-ink-soft">
        {label}<ChevronRight size={14} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      <Fold open={open}><ul className="mt-2 space-y-1 border-l border-line pl-3 ml-2">{stepRows(steps, false).map((s) => <StepRow key={s.id} s={s} />)}</ul></Fold>
    </div>
  )
}
