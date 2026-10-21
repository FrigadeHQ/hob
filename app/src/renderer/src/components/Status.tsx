import { useEffect, useRef, useState } from 'react'
import type { SetupState, VisionState } from '../../../shared/types'
import { mabel } from '../api'
import { Mascot } from './Mascot'

const gbOf = (n: number) => (n < 10 ? n.toFixed(1) : Math.round(n).toString())
const timeLeft = (s: number) => (s <= 0 ? '' : s < 90 ? 'about a minute left' : s < 5400 ? `about ${Math.round(s / 60)} min left` : `about ${Math.round(s / 3600)} h left`)

/**
 * Hover tooltip opening upward. Fixed to the window, so the narrow sidebar can't cut it off;
 * theme colors, so it stays dark in dark mode.
 */
function Tooltip({ content, children }: { content: React.ReactNode; children: React.ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [at, setAt] = useState<{ left: number; bottom: number } | null>(null)
  const show = () => { const r = ref.current?.getBoundingClientRect(); if (r) setAt({ left: Math.max(8, r.left), bottom: window.innerHeight - r.top + 8 }) }
  return (
    <span ref={ref} className="relative inline-flex" onMouseEnter={show} onMouseLeave={() => setAt(null)} onFocus={show} onBlur={() => setAt(null)}>
      {children}
      <span
        role="tooltip"
        data-testid="status-tooltip"
        style={at ? { left: at.left, bottom: at.bottom } : undefined}
        className={`pointer-events-none fixed z-50 w-64 max-w-[calc(100vw-16px)] rounded-card border border-line bg-surface px-3 py-2 text-meta text-ink shadow-lg transition duration-150 ${at ? 'opacity-100 translate-y-0' : 'invisible opacity-0 translate-y-1'}`}
      >
        {content}
      </span>
    </span>
  )
}

/** Mabel's eyes download after the main model; shown here until they're ready */
function useVision() {
  const [v, setV] = useState<VisionState>({ phase: 'off' })
  useEffect(() => { void mabel.vision.getState().then(setV); return mabel.vision.onState(setV) }, [])
  return v
}

export function Status({ state }: { state: SetupState }) {
  const vision = useVision()
  if (state.phase !== 'downloading' && state.phase !== 'ready') return null
  if (state.phase === 'ready' && !state.note && vision.phase === 'downloading') {
    const pct = Math.min(99, Math.floor(vision.progress * 100))
    return (
      <span className="flex min-w-0 items-center gap-2 text-meta text-ink-soft">
        <Mascot mini size={24} alive busy ticklish />
        <Tooltip content={<><span className="block font-medium">Mabel is ready to use</span><span className="block text-ink-soft">It's adding photo support, so it can look at images and screenshots: {pct}%.</span></>}>
          <span data-testid="status" tabIndex={0} className="flex items-center gap-2 cursor-default outline-none">
            <span>Adding photo support… {pct}%</span>
          </span>
        </Tooltip>
      </span>
    )
  }
  const pct = state.phase === 'downloading' ? Math.min(99, Math.floor(state.progress * 100)) : 100
  const label = state.phase === 'downloading' ? (state.note ?? `Getting smarter… ${pct}%`) : (state.note ?? 'Ready')
  const tip = state.phase === 'downloading' ? (
    <>
      <span className="block font-medium">{state.chatReady ? 'Mabel is ready to use' : 'Setting up Mabel'}</span>
      <span className="block text-ink-soft">
        {state.chatReady ? 'A smarter model is downloading' : `Downloading ${state.target.name}`}: {gbOf(state.target.sizeGB * Math.min(1, state.progress))} of {gbOf(state.target.sizeGB)} GB{timeLeft(state.etaSec) && `, ${timeLeft(state.etaSec)}`}.
      </span>
      {state.chatReady && <span className="mt-1 block text-ink-soft">Mabel switches to it by itself when it's done.</span>}
    </>
  ) : (
    <>
      <span className="block font-medium">{state.model.name}</span>
      <span className="block text-ink-soft">Runs on this computer. Your chats never leave it.</span>
    </>
  )
  return (
    <span className="flex min-w-0 items-center gap-2 text-meta text-ink-soft">
      {/* Mabel herself shows how she's doing: smiling when ready, hopping while she gets smarter, unsure when something went wrong */}
      <Mascot mini size={24} alive busy={state.phase === 'downloading'} base={state.phase === 'ready' && state.canRetry ? 'skeptical' : 'smile'} ticklish />
      <Tooltip content={tip}>
        <span data-testid="status" tabIndex={0} className="flex items-center gap-2 cursor-default outline-none">
          <span>{label}</span>
        </span>
      </Tooltip>
      {state.phase === 'ready' && state.canRetry && (
        <button data-testid="status-retry" onClick={() => mabel.setup.retry()} className="underline underline-offset-2 hover:text-ink">Try again</button>
      )}
    </span>
  )
}

