import { useEffect, useRef, useState } from 'react'
import type { ModelOption, SetupState } from '../../../shared/types'
import { mabel } from '../api'
import { Check, ChevronDown } from 'lucide-react'
import { Mascot } from '../components/Mascot'

const eta = (s: number) => (s <= 0 ? '' : s < 90 ? 'about a minute left' : s < 5400 ? `about ${Math.round(s / 60)} minutes left` : `about ${Math.round(s / 3600)} hours left`)
const gb = (n: number) => (n < 10 ? `${Math.ceil(n * 10) / 10} GB` : `${Math.ceil(n)} GB`)

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full flex flex-col">
      <div className="drag h-10 shrink-0" />
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-md text-center">{children}</div>
      </div>
    </div>
  )
}

const Step = ({ n }: { n: number }) => <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-line text-meta font-medium text-ink-soft">{n}</span>

const why = { memory: 'Needs more memory', slow: 'Too slow on this computer' }

function ModelRow({ m, selected, onPick }: { m: ModelOption; selected: boolean; onPick: () => void }) {
  return (
    <button
      data-testid="model-option"
      role="option"
      aria-selected={selected}
      disabled={!m.available}
      onClick={onPick}
      className={`w-full flex gap-3 items-start px-3 py-2.5 rounded-control text-left ${m.available ? 'hover:bg-line/60' : 'opacity-40 cursor-not-allowed'} ${selected ? 'bg-line/60' : ''}`}
    >
      <span className="flex w-4 shrink-0 justify-center pt-0.5">{selected && <Check size={14} strokeWidth={2} />}</span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-2">
          <span className="font-medium">{m.name}</span>
          {m.recommended && <span className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-ink text-paper">Recommended</span>}
        </span>
        <span className="block text-ui text-muted">{m.description}</span>
      </span>
      <span className="shrink-0 text-meta text-muted pt-1 text-right">{m.available ? `${m.blurb} · ${gb(m.sizeGB)}` : why[m.reason ?? 'memory']}</span>
    </button>
  )
}

function ModelPicker({ models, selected, onSelect }: { models: ModelOption[]; selected: ModelOption; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close) }
  }, [open])
  return (
    <div ref={ref} className="mt-4">
      <button data-testid="setup-other-options" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="text-ui text-muted hover:text-ink">
        {selected.recommended ? 'Choose a different model' : <>Using <span className="text-ink font-medium">{selected.name}</span> · change</>} <ChevronDown size={14} className="inline-block align-[-2px]" />
      </button>
      {open && (
        <div role="listbox" className="mt-3 p-1.5 max-h-[45vh] overflow-y-auto rounded-card border border-line bg-paper shadow-lg text-left">
          <p className="px-3 pt-1.5 pb-1 text-left text-meta text-muted">Smartest first. Smarter models are bigger and need more memory.</p>
          {models.filter((m) => m.available).map((m) => (
            <ModelRow key={m.id} m={m} selected={m.id === selected.id} onPick={() => { onSelect(m.id); setOpen(false) }} />
          ))}
          {models.some((m) => !m.available) && (
            <p className="px-3 pt-3 pb-1 text-[11px] uppercase tracking-wide text-muted border-t border-line mt-1.5">Needs a more powerful computer</p>
          )}
          {models.filter((m) => !m.available).map((m) => (
            <ModelRow key={m.id} m={m} selected={false} onPick={() => {}} />
          ))}
        </div>
      )}
    </div>
  )
}

/** while the first download runs: things to try once it's ready, like a game's loading screen */
const TIPS = [
  'Drop a spreadsheet into a chat and ask for a chart.',
  'Make a project to let Mabel work with a folder on your computer.',
  'Type / in a chat to use a skill, like /fill-pdf.',
  'After Mabel does something you’ll want again, say “save this as a skill”.',
  'Everything stays on your computer. Turn Web access off in Settings to stay fully offline.',
  'Mabel can rename, sort and tidy files for you, and Undo puts them back.',
  `Press ${navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl+'}K to search your chats.`,
  'You can keep chatting while a reply runs; switch chats and it keeps going.',
]
function Tips() {
  const [i, setI] = useState(() => Math.floor(Math.random() * TIPS.length))
  useEffect(() => { const t = setInterval(() => setI((n) => (n + 1) % TIPS.length), 6000); return () => clearInterval(t) }, [])
  return <p key={i} data-testid="setup-tip" className="fade-in mt-10 text-ui text-muted"><span className="font-medium text-ink-soft">Tip:</span> {TIPS[i]}</p>
}

/** first launch: what Mabel is doing while it looks at the computer. Loops; each line shows long enough to read */
const FIRST_RUN = ['Checking your computer…', 'Finding the most optimal model for your computer\'s memory and graphics…', 'Finding the best AI model for your computer…', 'Getting everything ready…']
/** every other start: a bit of warmth while the model loads */
const EVERYDAY_START = ['Stoking the fire…', 'Waking up the model…', 'Warming up…', 'Putting the kettle on…', 'Gathering your chats…', 'Fluffing the cushions…', 'Almost there…']
function ProbingLine({ firstRun }: { firstRun: boolean }) {
  const lines = firstRun ? FIRST_RUN : EVERYDAY_START
  const [i, setI] = useState(() => (firstRun ? 0 : Math.floor(Math.random() * lines.length)))
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % lines.length), 1600)
    return () => clearInterval(t)
  }, [lines])
  return <p key={i} data-testid="setup-probing" className="fade-in mt-5 text-body text-muted">{lines[i % lines.length]}</p>
}

export function Onboarding({ state }: { state: SetupState }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  if (state.phase === 'probing') {
    return (
      <Frame>
        <div className="flex flex-col items-center">
          <Mascot size={112} alive />
          {/* nothing until it's known whether this is the first launch, so the words don't switch */}
          {state.firstRun === undefined ? <p className="mt-5 text-body">&nbsp;</p> : <ProbingLine firstRun={state.firstRun} />}
        </div>
      </Frame>
    )
  }

  if (state.phase === 'error') {
    return (
      <Frame>
        <h1 className="text-title font-semibold mb-2">Something went wrong</h1>
        <p data-testid="setup-error" className="text-body text-ink-soft mb-6">{state.message}</p>
        <button onClick={() => mabel.setup.retry()} className="px-5 py-2.5 rounded-card bg-ink text-paper font-medium">Try again</button>
      </Frame>
    )
  }

  if (state.phase === 'choose') {
    const selected = state.models.find((m) => m.id === selectedId && m.available) ?? state.models.find((m) => m.recommended)!
    // a small model first gets chat going in minutes; not when the pick is that small model itself
    const starter = state.starter && state.starter.id !== selected.id ? state.starter : undefined
    return (
      <Frame>
        <div className="mb-4 flex justify-center"><Mascot size={84} alive /></div>
        <h1 className="text-title font-semibold tracking-tight mb-2">Welcome to Mabel</h1>
        <p className="text-body text-ink-soft mb-6">A private AI that runs entirely on your computer.</p>
        <div data-testid="setup-recommended" className="rounded-card border border-line bg-surface p-4 text-left mb-6">
          <p className="text-body font-medium">{selected.recommended ? 'We found the best AI model for your computer' : 'Your pick'}</p>
          <p className="text-ui text-ink-soft">{selected.recommended ? `Picked for your ${state.computer}.` : selected.name}</p>
          <ol className="mt-3 space-y-2 border-t border-line pt-3 text-ui text-ink-soft">
            {starter
              ? <>
                  <li className="flex gap-2.5"><Step n={1} /><span>A small model downloads first ({gb(starter.sizeGB)}), so you can start chatting in a few minutes.</span></li>
                  <li className="flex gap-2.5"><Step n={2} /><span>The full model ({gb(selected.sizeGB)}) keeps downloading in the background. Mabel switches to it by itself when it's done, and gets a lot smarter.</span></li>
                </>
              : <li className="flex gap-2.5"><Step n={1} /><span>One-time {gb(selected.sizeGB)} download, then it works offline.</span></li>}
          </ol>
        </div>
        {selected.needsDiskGB > 0 && <p className="text-accent mb-4">Not enough disk space. Free up {Math.ceil(selected.needsDiskGB)} GB to continue.</p>}
        <button data-testid="setup-download" onClick={() => mabel.setup.confirm(selected.id)} disabled={selected.needsDiskGB > 0} className="w-full py-3 rounded-card bg-ink text-paper font-medium text-body disabled:opacity-30">
          Download and start
        </button>
        {selected.needsDiskGB > 0 && <button onClick={() => mabel.setup.retry()} className="mt-3 w-full py-2.5 rounded-card border border-line font-medium">Check again</button>}
        <ModelPicker models={state.models} selected={selected} onSelect={setSelectedId} />
        {state.liteMode && <p className="mt-6 text-meta text-muted">Mabel will use a smaller model on this computer, so answers may be simpler.</p>}
      </Frame>
    )
  }

  if (state.phase === 'downloading') {
    const pct = Math.min(99, Math.floor(state.progress * 100))
    const finishing = state.progress >= 1
    return (
      <Frame>
        <div className="mb-4 flex justify-center"><Mascot size={84} alive /></div>
        <h1 className="text-title font-semibold mb-2">{state.starter ? 'Getting you started' : 'Setting up Mabel'}</h1>
        <p data-testid="setup-downloading" className="text-body text-ink-soft mb-6">
          {state.starter
            ? `Downloading a small model (${gb(state.starter.sizeGB)}) so you can chat in a few minutes. The full model (${gb(state.target.sizeGB)}) downloads after that, in the background.`
            : `One-time ${gb(state.target.sizeGB)} download, then it works offline.`}
        </p>
        <div className="h-2 rounded-full bg-line overflow-hidden">
          <div data-testid="setup-progress" className={`h-full bg-ink transition-all ${finishing ? 'animate-pulse' : ''}`} style={{ width: `${finishing ? 100 : pct}%` }} />
        </div>
        <p className="mt-3 text-ui text-muted">{finishing ? 'Almost ready…' : `${pct}%${eta(state.etaSec) ? ` · ${eta(state.etaSec)}` : ''}`}</p>
        <Tips />
      </Frame>
    )
  }

  return null
}
