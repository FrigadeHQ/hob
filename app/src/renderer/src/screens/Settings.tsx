import { useEffect, useState } from 'react'
import type { ModelRow, UserSettings } from '../../../shared/agent'
import type { SetupState, VisionState } from '../../../shared/types'
import { garth } from '../api'
import { Dialog, Switch, button } from '../components/ui'
import { ModelPicker } from '../components/ModelPicker'

const gb = (n: number) => (n < 10 ? `${n.toFixed(1)} GB` : `${Math.round(n)} GB`)
const left = (s: number) => (s <= 0 ? '' : s < 90 ? ' · about a minute left' : s < 5400 ? ` · about ${Math.round(s / 60)} minutes left` : ` · about ${Math.round(s / 3600)} hours left`)

/** a row: label (and help) on the left, the control on the right */
export function Row({ label, help, children, testId }: { label: string; help?: string; children: React.ReactNode; testId?: string }) {
  return (
    <div data-testid={testId} className="flex items-center justify-between gap-6 border-b border-line py-3.5 last:border-b-0">
      <div className="min-w-0"><p className="text-ui font-medium">{label}</p>{help && <p className="text-meta text-muted">{help}</p>}</div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

/** a few options side by side, one picked (Small · Medium · Large) */
export function Segmented<T extends string>({ value, options, onChange, testId }: { value: T; options: { id: T; label: React.ReactNode; title?: string }[]; onChange(v: T): void; testId?: string }) {
  return (
    <div data-testid={testId} role="radiogroup" className="inline-flex rounded-control bg-line/60 p-0.5">
      {options.map((o) => (
        <button key={o.id} role="radio" aria-checked={value === o.id} title={o.title} aria-label={o.title} onClick={() => onChange(o.id)}
          className={`inline-flex items-center rounded-[7px] px-3 py-1 text-ui ${value === o.id ? 'bg-surface text-ink shadow-sm' : 'text-ink-soft hover:text-ink'}`}>{o.label}</button>
      ))}
    </div>
  )
}

export const Heading = ({ children }: { children: React.ReactNode }) => <h2 className="mt-8 mb-1 text-body font-semibold first:mt-0">{children}</h2>

/** the models this computer can run, and Garth's image model */
export function ModelSettings() {
  const [models, setModels] = useState<ModelRow[]>([])
  const [vision, setVision] = useState<VisionState>({ phase: 'off' })
  useEffect(() => { void garth.vision.getState().then(setVision); return garth.vision.onState(setVision) }, [])
  /** the download in progress (or about to start, the moment Download is clicked) */
  const [setup, setSetup] = useState<SetupState | null>(null)
  const [starting, setStarting] = useState<string | null>(null)
  const reload = () => void garth.models.list().then(setModels)
  useEffect(() => {
    reload()
    void garth.setup.getState().then(setSetup)
    return garth.setup.onState((st) => { setSetup(st); if (st.phase !== 'downloading') setStarting(null); reload() })
  }, [])
  const downloading = setup?.phase === 'downloading' ? setup : null
  const busyId = downloading?.target.id ?? starting
  function use(id: string) {
    if (busyId) return
    setStarting(id)
    void garth.models.use(id).then(reload).finally(() => setStarting((cur) => (cur === id ? null : cur)))
  }
  const [picking, setPicking] = useState(false)
  const active = models.find((m) => m.active)
  const pending = busyId ? models.find((m) => m.id === busyId) : undefined
  const spare = models.filter((m) => m.downloaded && !m.active && m.id !== busyId)
  return (
    <>
      <Heading>Model</Heading>
      <p className="mb-3 text-meta text-muted">The AI model Garth runs on this computer. Bigger ones are smarter but slower.</p>
      <div data-testid="settings-current-model" className="rounded-card border border-line bg-surface px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-medium">{active?.name ?? '…'}</p>
            {active && <p className="text-ui text-muted">{active.description}</p>}
            {active && <p className="mt-0.5 text-meta text-muted">{active.blurb} · {gb(active.sizeGB)}</p>}
          </div>
          <button disabled={!!busyId || !active} title={busyId ? 'Wait for the current download to finish' : undefined} onClick={() => setPicking(true)} className={button.secondary}>Change model</button>
        </div>
        {busyId && (
          <div data-testid="model-progress" className="mt-3 border-t border-line pt-3">
            <p className="text-meta text-ink-soft">
              {downloading
                ? `Downloading ${downloading.target.name}… ${Math.min(99, Math.floor(downloading.progress * 100))}%${left(downloading.etaSec)}`
                : pending?.downloaded ? `Switching to ${pending.name}…` : `Starting ${pending?.name ?? 'the download'}…`}
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full bg-ink transition-[width] duration-500" style={{ width: `${downloading ? Math.max(3, downloading.progress * 100) : 3}%` }} />
              </div>
              {/* stop it: chat stays on the model in use; what came down so far is kept for later */}
              {downloading && <button data-testid="model-cancel" onClick={() => void garth.models.cancel()} className="text-meta text-muted underline-offset-2 hover:text-ink hover:underline">Cancel</button>}
            </div>
            <p className="mt-1.5 text-meta text-muted">You can keep chatting; Garth switches when it's ready.</p>
          </div>
        )}
      </div>
      {spare.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-meta text-muted">Also downloaded</p>
          <div className="rounded-card border border-line bg-surface divide-y divide-line">
            {spare.map((m) => (
              <div key={m.id} data-testid="settings-model" className="flex items-center gap-3 px-4 py-2.5 text-ui">
                <span className="flex-1">{m.name} <span className="text-muted">· {gb(m.sizeGB)}</span></span>
                <button data-testid="model-delete" onClick={() => void garth.models.remove(m.id).then(reload)} className="text-ui text-muted hover:text-ink">Delete</button>
              </div>
            ))}
          </div>
        </div>
      )}
      {picking && active && (
        <ModelPicker models={models} selected={active} note="Garth keeps chatting on the current model while a new one downloads."
          onSelect={(id) => { if (id !== active.id) use(id) }} onClose={() => setPicking(false)} />
      )}
          <Heading>Seeing images</Heading>
          <p className="text-ui text-muted mb-3">A small extra model that lets Garth look at photos and screenshots. It runs on this computer.</p>
          <div data-testid="settings-vision" className="flex items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 text-ui">
            <span className="flex-1">
              {vision.phase === 'ready' ? `Ready · ${vision.name} · ${gb(vision.sizeGB)}`
                : vision.phase === 'downloading' ? `Downloading… ${Math.min(99, Math.floor(vision.progress * 100))}%`
                : vision.phase === 'error' ? `Couldn't download it: ${vision.message}`
                : 'Downloads after the main model'}
            </span>
            {vision.phase === 'error' && <button className={button.secondary} onClick={() => void garth.vision.retry()}>Try again</button>}
          </div>
    </>
  )
}

/** Web access: the one switch between offline and online */
export function PrivacySettings() {
  const [s, setS] = useState<UserSettings | null>(null)
  useEffect(() => { void garth.settings.get().then(setS) }, [])
  return (
    <>
      <Heading>Privacy</Heading>
      <p className="mb-2 text-meta text-muted">Garth runs on this computer. Your chats and files never leave it.</p>
      <Row label="Web access" help="Lets Garth search the web, read pages, and let its code fetch data and install Python packages. Turn it off to stay fully offline.">
        <Switch testId="web-toggle" label="Web access" on={!!s?.webAccess} onChange={(on) => s && void garth.settings.set({ webAccess: on }).then(setS)} />
      </Row>
    </>
  )
}

/** where chat files go, how much space Garth uses, and deleting every chat */
export function FilesSettings({ onAllChatsDeleted }: { onAllChatsDeleted(): void }) {
  const [s, setS] = useState<UserSettings | null>(null)
  const [storage, setStorage] = useState<{ modelsGB: number; filesGB: number; codeToolsGB: number } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [chatCount, setChatCount] = useState(0)
  const reload = () => void garth.storage.get().then(setStorage)
  useEffect(() => { reload(); void garth.settings.get().then(setS) }, [])
  return (
    <>
      <Heading>Files</Heading>
      <Row label="Chat files" help="Each chat keeps its files in its own folder here.">
        <button onClick={() => void garth.settings.pickFilesDir().then(async (d) => { if (d) setS(await garth.settings.set({ filesDir: d })) })} className={button.secondary}>Change…</button>
      </Row>
      <code data-testid="files-dir" className="block truncate rounded bg-line/50 px-2 py-1 text-meta">{s?.filesDir}</code>
      <Heading>Storage</Heading>
      <section data-testid="storage">
        {storage && (
          <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-ui">
            <dt className="text-muted">Models</dt><dd>{gb(storage.modelsGB)}</dd>
            <dt className="text-muted">Chat files</dt><dd>{gb(storage.filesGB)}</dd>
            <dt className="text-muted">Code tools</dt><dd>{gb(storage.codeToolsGB)}</dd>
          </dl>
        )}
      </section>
      <div className="mt-8">
        <section data-testid="danger-zone">
          <h2 className="text-body font-medium mb-2 text-danger">Danger zone</h2>
          <div className="flex items-center justify-between gap-6 rounded-card border border-danger/30 px-4 py-3">
            <div>
              <p className="font-medium">Delete all chats</p>
              <p className="text-ui text-muted">Removes every chat from Garth. Files they made stay in your files folder. This can’t be undone.</p>
            </div>
            <button data-testid="delete-all-chats" onClick={() => void garth.chats.list().then((c) => { setChatCount(c.length); setConfirmDelete(true) })}
              className="shrink-0 rounded-control border border-danger/40 px-3 py-1.5 text-ui font-medium text-danger transition-colors hover:bg-danger/10">
              Delete all chats
            </button>
          </div>
        </section>
      </div>
      {confirmDelete && (
        <Dialog title={`Delete all ${chatCount} ${chatCount === 1 ? 'chat' : 'chats'}?`} testId="confirm-delete-all" onClose={() => setConfirmDelete(false)}>
          <p className="text-ui text-ink-soft">Every chat will be removed from Garth. Files they made stay in your files folder.</p>
          <p className="mt-2 text-ui font-medium">This can’t be undone.</p>
          <div className="mt-5 flex justify-end gap-2">
            <button autoFocus onClick={() => setConfirmDelete(false)} className={button.secondary}>Cancel</button>
            <button data-testid="confirm-delete-all-yes" onClick={() => { setConfirmDelete(false); void garth.chats.removeAll().then(() => { onAllChatsDeleted(); reload() }) }}
              className="inline-flex items-center rounded-control bg-danger px-3 py-1.5 text-ui font-medium text-white transition-opacity hover:opacity-90">
              Delete all chats
            </button>
          </div>
        </Dialog>
      )}
    </>
  )
}
