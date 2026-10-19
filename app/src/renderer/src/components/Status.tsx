import type { SetupState } from '../../../shared/types'
import { hob } from '../api'

const gbOf = (n: number) => (n < 10 ? n.toFixed(1) : Math.round(n).toString())
const timeLeft = (s: number) => (s <= 0 ? '' : s < 90 ? 'about a minute left' : s < 5400 ? `about ${Math.round(s / 60)} min left` : `about ${Math.round(s / 3600)} h left`)

/** shadcn-style hover tooltip, opening upward */
function Tooltip({ content, children }: { content: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span
        role="tooltip"
        data-testid="status-tooltip"
        className="pointer-events-none absolute bottom-full left-0 mb-2 w-64 rounded-control bg-ink px-3 py-2 text-meta text-paper shadow-md opacity-0 translate-y-1 transition duration-150 group-hover:opacity-100 group-hover:translate-y-0 group-focus-within:opacity-100"
      >
        {content}
      </span>
    </span>
  )
}

export function Status({ state }: { state: SetupState }) {
  if (state.phase !== 'downloading' && state.phase !== 'ready') return null
  const pct = state.phase === 'downloading' ? Math.min(99, Math.floor(state.progress * 100)) : 100
  const label = state.phase === 'downloading' ? (state.note ?? `Getting smarter… ${pct}%`) : (state.note ?? 'Ready')
  const tip = state.phase === 'downloading' ? (
    <>
      <span className="block font-medium">Downloading {state.target.name}</span>
      <span className="block opacity-70">
        {gbOf(state.target.sizeGB * Math.min(1, state.progress))} of {gbOf(state.target.sizeGB)} GB{timeLeft(state.etaSec) && ` · ${timeLeft(state.etaSec)}`}
      </span>
      <span className="block mt-1 opacity-70">Hob switches to it automatically when it's done. Keep chatting in the meantime.</span>
    </>
  ) : (
    <>
      <span className="block font-medium">{state.model.name}</span>
      <span className="block opacity-70">Running locally. Nothing leaves this computer.</span>
    </>
  )
  return (
    <span className="flex min-w-0 items-center gap-2 text-meta text-ink-soft">
      <Tooltip content={tip}>
        <span data-testid="status" tabIndex={0} className="flex items-center gap-2 cursor-default outline-none">
          <span className={`size-2 shrink-0 rounded-full ${state.phase === 'ready' ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`} />
          <span>{label}</span>
        </span>
      </Tooltip>
      {state.phase === 'ready' && state.canRetry && (
        <button data-testid="status-retry" onClick={() => hob.setup.retry()} className="underline underline-offset-2 hover:text-ink">Try again</button>
      )}
    </span>
  )
}

