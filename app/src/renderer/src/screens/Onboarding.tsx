import { useEffect, useState } from 'react'
import type { ModelOption, SetupState } from '../../../shared/types'
import { hob } from '../api'
import { ChevronRight, LoaderCircle } from 'lucide-react'
import { Mascot } from '../components/Mascot'
import { Dialog } from '../components/ui'
import { ModelPicker } from '../components/ModelPicker'

const eta = (s: number) => (s <= 0 ? 'Estimating time remaining…' : s < 90 ? 'About a minute left' : s < 5400 ? `About ${Math.round(s / 60)} minutes left` : `About ${Math.round(s / 3600)} hours left`)
const gb = (n: number) => `${Math.ceil(n * 10) / 10} GB`
function DownloadDetails({ state, onClose }: { state: Extract<SetupState, { phase: 'downloading' }>; onClose(): void }) {
  const current = state.starter ?? state.target
  const progress = Math.max(0, Math.min(1, state.progress))
  return (
    <Dialog title="Download details" onClose={onClose} testId="setup-details-dialog" className="setup-dialog setup-details-dialog">
      <div className="setup-download-details">
        <div className="setup-detail-row" data-testid="download-detail-row">
          <div><p>{current.name}{state.starter ? ' · Starter model' : ''}</p><small>{progress >= 1 ? gb(current.sizeGB) : `${(current.sizeGB * progress).toFixed(1)} GB`} of {gb(current.sizeGB)}</small></div>
          <span>{progress >= 1 ? 'Preparing' : 'Downloading'}</span>
        </div>
        {state.starter && <>
          <div className="setup-detail-row" data-testid="download-detail-row">
            <div><p>{state.target.name}</p><small>{gb(state.target.sizeGB)} · Downloads while you chat</small></div><span>Up next</span>
          </div>
          <p className="setup-detail-explanation">Start chatting with the smaller model first.</p>
        </>}
        {state.note && <p className="setup-detail-explanation">{state.note}</p>}
      </div>
      <div className="setup-dialog-footer"><span>Chat opens automatically when it’s ready.</span><button className="setup-primary" onClick={onClose}>Done</button></div>
    </Dialog>
  )
}

/** First launch: the final line stays until the computer checks finish. */
const FIRST_RUN = ['Starting Hob…', 'Checking your computer…', 'Reviewing available AI models…', 'Finding the best fit for your computer…']
const EVERYDAY_START = ['Stoking the fire…', 'Waking up the model…', 'Warming up…', 'Putting the kettle on…', 'Gathering your chats…', 'Fluffing the cushions…', 'Almost there…']
function ProbingLine({ firstRun }: { firstRun: boolean }) {
  const lines = firstRun ? FIRST_RUN : EVERYDAY_START
  const [i, setI] = useState(() => (firstRun ? 0 : Math.floor(Math.random() * lines.length)))
  useEffect(() => {
    if (firstRun && i >= lines.length - 1) return
    const t = setTimeout(() => setI((n) => n + 1), 3200)
    return () => clearTimeout(t)
  }, [firstRun, i, lines.length])
  return (
    <p data-testid="setup-probing" role="status" className="setup-status inline-flex items-center gap-2 whitespace-nowrap text-body text-muted">
      <LoaderCircle size={14} strokeWidth={1.5} aria-hidden="true" className="shrink-0 animate-spin opacity-70 [animation-duration:1.2s] motion-reduce:animate-none" />
      <span key={i} className="fade-in">{lines[i % lines.length]}</span>
    </p>
  )
}

export function Onboarding({ state }: { state: SetupState }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'models' | 'details' | null>(null)
  const [firstRun, setFirstRun] = useState<boolean>()
  useEffect(() => { if (state.phase === 'probing' && state.firstRun !== undefined) setFirstRun(state.firstRun) }, [state])
  useEffect(() => setDialog(null), [state.phase])
  const probing = state.phase === 'probing'
  const selected = state.phase === 'choose' ? state.models.find((m) => m.id === selectedId && m.available) ?? state.models.find((m) => m.recommended)! : undefined
  // the starter comes first only when it's the quicker download (see install in setup.ts)
  const starter = state.phase === 'choose' && selected && state.starter && state.starter.sizeGB < selected.sizeGB ? state.starter : undefined
  const downloading = state.phase === 'downloading'
  const finishing = downloading && state.progress >= 1
  const pct = downloading ? Math.max(0, Math.min(100, Math.floor(state.progress * 100))) : 0

  return (
    <div className="onboarding relative h-full flex flex-col" data-phase={state.phase}>
      <div className="drag h-10 shrink-0" />
      <div className="onboarding-screen">
        <div className="onboarding-content">
          {/* One mounted Hob carries the transition from checking to setup. */}
          <div className="onboarding-mascot"><div className="setup-avatar"><Mascot size={72} alive playful /></div></div>
          <div className="onboarding-probing" aria-hidden={!probing}>
            {firstRun !== undefined && <ProbingLine firstRun={firstRun} />}
          </div>
          <div className="onboarding-panel" inert={probing} aria-hidden={probing}>
            <div key={`heading-${state.phase}`} className="setup-heading">
              <h1>{state.phase === 'error' ? 'Something went wrong' : downloading ? 'Getting Hob ready' : 'Welcome to Hob'}</h1>
              <p className="setup-subtitle">{state.phase === 'error' ? 'Let’s try that again.' : downloading ? 'Chat will open automatically.' : `Your private AI, right on your ${hob.platform === 'darwin' ? 'Mac' : 'computer'}.`}</p>
            </div>
            <div key={`stage-${state.phase}`} className="setup-stage">
              {state.phase === 'choose' && selected && <>
                <div className="setup-card" data-testid="setup-recommended">
                  <p className="setup-hardware" title={state.computer}>{selected.recommended ? 'Picked for your' : 'Your'} {state.computer}</p>
                  <div className="setup-model-line"><span className="setup-model-name">{selected.name}</span>
                    <button className="setup-text-button" data-testid="setup-other-options" aria-haspopup="dialog" onClick={() => setDialog('models')}>Change model <ChevronRight size={13} /></button>
                  </div>
                </div>
                <button data-testid="setup-download" disabled={selected.needsDiskGB > 0} className="setup-primary" onClick={() => void hob.setup.confirm(selected.id)}>Download and start</button>
                <p data-testid="setup-download-size" className="setup-small-print">{gb(selected.sizeGB + (starter?.sizeGB ?? 0))} download</p>
                {selected.needsDiskGB > 0 && <div className="setup-notice" role="status"><p>Free up {Math.ceil(selected.needsDiskGB)} GB of disk space to continue.</p><button className="setup-text-button" onClick={() => void hob.setup.retry()}>Check again</button></div>}
                {state.liteMode && <p className="setup-small-print">A smaller model for this computer. Answers may be simpler.</p>}
              </>}
              {downloading && <>
                <div className="setup-card" data-testid="setup-progress-card">
                  <div className="setup-progress-label"><span data-testid="setup-downloading">{finishing ? 'Finishing setup' : 'Downloading'}</span>{!finishing && <span className="tabular-nums">{pct}%</span>}</div>
                  <div className="setup-track" role="progressbar" aria-label="Model download" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={finishing ? 'Download received, finishing setup' : undefined}>
                    <span data-testid="setup-progress" style={{ transform: `scaleX(${pct / 100})` }} />
                  </div>
                  <p data-testid="setup-eta" className="setup-eta" role="status">{finishing ? 'Almost ready…' : eta(state.etaSec)}</p>
                </div>
                <button className="setup-text-button" aria-haspopup="dialog" onClick={() => setDialog('details')}>Download details <ChevronRight size={13} /></button>
              </>}
              {state.phase === 'error' && <><p data-testid="setup-error" className="text-body text-ink-soft">{state.message}</p><button className="setup-primary" onClick={() => void hob.setup.retry()}>Try again</button></>}
            </div>
          </div>
        </div>
      </div>
      {firstRun && <p className="setup-assurance absolute inset-x-6 bottom-6 whitespace-nowrap text-center text-meta font-light text-muted" aria-hidden={!probing}>We’ll ask before downloading a model.</p>}
      {dialog === 'models' && state.phase === 'choose' && selected && <ModelPicker models={state.models} selected={selected} onSelect={setSelectedId} onClose={() => setDialog(null)} />}
      {dialog === 'details' && downloading && <DownloadDetails state={state} onClose={() => setDialog(null)} />}
    </div>
  )
}
