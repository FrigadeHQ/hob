import { useEffect, useState } from 'react'
import type { ModelOption, SetupState } from '../../../shared/types'
import { hob } from '../api'
import { ChevronRight, LoaderCircle } from 'lucide-react'
import { Mascot } from '../components/Mascot'
import { Dialog } from '../components/ui'
import { ModelPicker } from '../components/ModelPicker'
import { language, msg, t } from '../../../shared/i18n'

const eta = (s: number) => (s <= 0 ? t('Estimating time remaining…') : s < 90 ? t('About a minute left') : s < 5400 ? t('About {count} minutes left', { count: Math.round(s / 60) }) : t('About {count} hours left', { count: Math.round(s / 3600) }))
const gb = (n: number) => t('{size} GB', { size: Math.ceil(n * 10) / 10 })
function DownloadDetails({ state, onClose }: { state: Extract<SetupState, { phase: 'downloading' }>; onClose(): void }) {
  const current = state.starter ?? state.target
  const progress = Math.max(0, Math.min(1, state.progress))
  return (
    <Dialog title={t('Download details')} onClose={onClose} testId="setup-details-dialog" className="setup-dialog setup-details-dialog">
      <div className="setup-download-details">
        <div className="setup-detail-row" data-testid="download-detail-row">
          <div><p>{current.name}{state.starter ? ` · ${t('Starter model')}` : ''}</p><small>{t('{done} of {total}', { done: progress >= 1 ? gb(current.sizeGB) : t('{size} GB', { size: new Intl.NumberFormat(language(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(current.sizeGB * progress) }), total: gb(current.sizeGB) })}</small></div>
          <span>{progress >= 1 ? t('Preparing') : t('Downloading')}</span>
        </div>
        {state.starter && <>
          <div className="setup-detail-row" data-testid="download-detail-row">
            <div><p>{state.target.name}</p><small>{gb(state.target.sizeGB)} · {t('Downloads while you chat')}</small></div><span>{t('Up next')}</span>
          </div>
          <p className="setup-detail-explanation">{t('Start chatting with the smaller model first.')}</p>
        </>}
        {state.note && <p className="setup-detail-explanation">{state.note}</p>}
      </div>
      <div className="setup-dialog-footer"><span>{t('Chat opens automatically when it’s ready.')}</span><button className="setup-primary" onClick={onClose}>{t('Done')}</button></div>
    </Dialog>
  )
}

/** First launch: the final line stays until the computer checks finish. */
const FIRST_RUN = [msg('Starting Hob…'), msg('Checking your computer…'), msg('Reviewing available AI models…'), msg('Finding the best fit for your computer…')]
const EVERYDAY_START = [msg('Waking up…'), msg('Getting ready…'), msg('Finding my focus…'), msg('Just a moment…')]
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
      <span key={i} className="fade-in">{t(lines[i % lines.length])}</span>
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
          <div className="onboarding-mascot"><Mascot size={72} alive playful /></div>
          <div className="onboarding-probing" aria-hidden={!probing}>
            {firstRun !== undefined && <ProbingLine firstRun={firstRun} />}
          </div>
          <div className="onboarding-panel" inert={probing} aria-hidden={probing}>
            <div className="setup-heading">
              <h1>{state.phase === 'error' ? t('Something went wrong') : downloading ? t('Getting Hob ready') : t('Welcome to Hob')}</h1>
              <p className="setup-subtitle">{state.phase === 'error' ? t('Let’s try that again.') : downloading ? t('Chat will open automatically.') : hob.platform === 'darwin' ? t('Your private AI, right on your Mac.') : t('Your private AI, right on your computer.')}</p>
            </div>
            <div className="setup-stage">
              {state.phase === 'choose' && selected && <>
                <div className="setup-card" data-testid="setup-recommended">
                  <p className="setup-hardware" title={state.computer}>{selected.recommended ? t('Picked for your {computer}', { computer: state.computer }) : t('Your {computer}', { computer: state.computer })}</p>
                  <div className="setup-model-line"><span className="setup-model-name">{selected.name}</span>
                    <button className="setup-text-button" data-testid="setup-other-options" aria-haspopup="dialog" onClick={() => setDialog('models')}>{t('Change model')} <ChevronRight size={13} className="rtl:-scale-x-100" /></button>
                  </div>
                </div>
                <button data-testid="setup-download" disabled={selected.needsDiskGB > 0} className="setup-primary" onClick={() => void hob.setup.confirm(selected.id)}>{t('Download and start')}</button>
                <p data-testid="setup-download-size" className="setup-small-print">{t('{size} download', { size: gb(selected.sizeGB + (starter?.sizeGB ?? 0)) })}</p>
                {selected.needsDiskGB > 0 && <div className="setup-notice" role="status"><p>{t('Free up {size} GB of disk space to continue.', { size: Math.ceil(selected.needsDiskGB) })}</p><button className="setup-text-button" onClick={() => void hob.setup.retry()}>{t('Check again')}</button></div>}
                {state.liteMode && <p className="setup-small-print">{t('A smaller model for this computer. Answers may be simpler.')}</p>}
              </>}
              {downloading && <>
                <div className="setup-card" data-testid="setup-progress-card">
                  <div className="setup-progress-label"><span data-testid="setup-downloading">{finishing ? t('Finishing setup') : t('Downloading')}</span>{!finishing && <span className="tabular-nums">{pct}%</span>}</div>
                  <div className="setup-track" role="progressbar" aria-label={t('Model download')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={finishing ? t('Download received, finishing setup') : undefined}>
                    <span data-testid="setup-progress" style={{ transform: `scaleX(${pct / 100})` }} />
                  </div>
                  <p data-testid="setup-eta" className="setup-eta" role="status">{finishing ? t('Almost ready…') : eta(state.etaSec)}</p>
                </div>
                <button className="setup-text-button" aria-haspopup="dialog" onClick={() => setDialog('details')}>{t('Download details')} <ChevronRight size={13} className="rtl:-scale-x-100" /></button>
              </>}
              {state.phase === 'error' && <><p data-testid="setup-error" className="text-body text-ink-soft">{state.message}</p><button className="setup-primary" onClick={() => void hob.setup.retry()}>{t('Try again')}</button></>}
            </div>
          </div>
        </div>
      </div>
      {firstRun && <p className="setup-assurance absolute inset-x-6 bottom-6 whitespace-nowrap text-center text-meta font-light text-muted" aria-hidden={!probing}>{t('We’ll ask before downloading a model.')}</p>}
      {dialog === 'models' && state.phase === 'choose' && selected && <ModelPicker models={state.models} selected={selected} onSelect={setSelectedId} onClose={() => setDialog(null)} />}
      {dialog === 'details' && downloading && <DownloadDetails state={state} onClose={() => setDialog(null)} />}
    </div>
  )
}
