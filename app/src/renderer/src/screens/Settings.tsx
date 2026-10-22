import { useEffect, useState } from 'react'
import type { ModelRow, UserSettings } from '../../../shared/agent'
import type { SetupState, StorageUsage, VisionState } from '../../../shared/types'
import { ChevronDown } from 'lucide-react'
import { hob } from '../api'
import { Dialog, Switch, button } from '../components/ui'

const gb = (n: number) => n > 0 && n < .1 ? 'Less than 0.1 GB' : `${n.toFixed(1)} GB`
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

/** the models this computer can run, and Hob's image model */
export function ModelSettings() {
  const [models, setModels] = useState<ModelRow[]>([])
  const [showOther, setShowOther] = useState(false)
  const [vision, setVision] = useState<VisionState>({ phase: 'off' })
  useEffect(() => { void hob.vision.getState().then(setVision); return hob.vision.onState(setVision) }, [])
  /** the download in progress (or about to start, the moment Download is clicked) */
  const [setup, setSetup] = useState<SetupState | null>(null)
  const [starting, setStarting] = useState<string | null>(null)
  const reload = () => void hob.models.list().then(setModels)
  useEffect(() => {
    reload()
    void hob.setup.getState().then(setSetup)
    return hob.setup.onState((st) => { setSetup(st); if (st.phase !== 'downloading') setStarting(null); reload() })
  }, [])
  const downloading = setup?.phase === 'downloading' ? setup : null
  const busyId = downloading?.target.id ?? starting
  const unavailable = models.filter((m) => !m.available)
  function use(id: string) {
    if (busyId) return
    setStarting(id)
    void hob.models.use(id).then(reload).finally(() => setStarting((cur) => (cur === id ? null : cur)))
  }
  return (
    <>
      <Heading>Models</Heading>
      <p className="mb-3 text-meta text-muted">Choose a chat model for this computer. Downloading another model also switches Hob to it.</p>
          <div data-testid="model-list" className="rounded-card border border-line bg-surface divide-y divide-line">
            <p className="px-4 py-2 text-meta font-medium text-muted">Chat models</p>
            {models.filter((m) => m.available).map((m) => (
              <div key={m.id} data-testid="settings-model" className="flex items-start gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium">
                    {m.name}
                    {m.active && <span className="ml-2 rounded-full bg-line px-2 text-meta font-normal leading-5 text-ink-soft">{m.recommended ? 'In use · Recommended' : 'In use'}</span>}
                    {m.recommended && !m.active && <span className="ml-2 rounded-full bg-line/60 px-2 text-meta font-normal leading-5 text-ink-soft">Recommended</span>}
                  </p>
                  <p className="text-ui text-muted">{m.description}</p>
                  <p className="text-meta text-muted mt-0.5">{gb(m.sizeGB)}{m.downloaded ? ' · Downloaded' : ' download'}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                {busyId === m.id && !m.active ? (
                  <div data-testid="model-progress" className="w-44 shrink-0 pt-1">
                    <p className="text-meta text-ink-soft">
                      {downloading && downloading.target.id === m.id
                        ? `Downloading… ${Math.min(99, Math.floor(downloading.progress * 100))}%${left(downloading.etaSec)}`
                        : m.downloaded ? 'Switching…' : 'Starting…'}
                    </p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                        <div className="h-full rounded-full bg-ink transition-[width] duration-500" style={{ width: `${downloading && downloading.target.id === m.id ? Math.max(3, downloading.progress * 100) : 3}%` }} />
                      </div>
                      {/* stop it: chat stays on the model in use; what came down so far is kept for later */}
                      {downloading && downloading.target.id === m.id && (
                        <button data-testid="model-cancel" onClick={() => void hob.models.cancel()} className="text-meta text-muted underline-offset-2 hover:text-ink hover:underline">Cancel</button>
                      )}
                    </div>
                  </div>
                ) : !m.active && (
                  <button data-testid="model-use" disabled={!!busyId} title={busyId ? 'Wait for the current download to finish' : undefined} onClick={() => use(m.id)} className={`${button.secondary} whitespace-nowrap shrink-0`}>
                    {m.downloaded ? 'Use model' : 'Download & use'}
                  </button>
                )}
                {m.downloaded && !m.active && busyId !== m.id && (
                  <button data-testid="model-delete" disabled={!!busyId} aria-label={`Remove download of ${m.name}`} onClick={() => void hob.models.remove(m.id).then(reload)} className="text-meta text-muted hover:text-ink py-1.5 shrink-0 disabled:opacity-50">Remove download</button>
                )}
                </div>
              </div>
            ))}
            <p className="px-4 py-2 text-meta font-medium text-muted">Image support</p>
            <div data-testid="settings-vision" className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{vision.phase === 'ready' ? vision.name : 'Photos and screenshots'}
                  {vision.phase === 'ready' && <span className="ml-2 rounded-full bg-line px-2 text-meta font-normal leading-5 text-ink-soft">Downloaded</span>}
                </p>
                <p className="text-ui text-muted">Added automatically. Only needed for photos and screenshots.</p>
                <p className="mt-0.5 text-meta text-muted">
                  {vision.phase === 'ready' ? `${gb(vision.sizeGB)} · Used when you attach an image`
                    : vision.phase === 'downloading' ? `Downloading… ${Math.min(99, Math.floor(vision.progress * 100))}% · You can keep chatting`
                    : vision.phase === 'error' ? `Download interrupted: ${vision.message}`
                    : 'Not downloaded yet · Downloads after chat is ready'}
                </p>
                {vision.phase === 'downloading' && <div role="progressbar" aria-label="Image support download" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(vision.progress * 100)} className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
                  <div className="h-full rounded-full bg-ink" style={{ width: `${Math.max(1, vision.progress * 100)}%` }} />
                </div>}
              </div>
              {vision.phase === 'error' && <button className={button.secondary} onClick={() => void hob.vision.retry()}>Try again</button>}
            </div>
          </div>
          {unavailable.length > 0 && <>
            <button data-testid="other-models" aria-expanded={showOther} aria-controls="other-model-list" onClick={() => setShowOther(!showOther)} className="mt-3 flex items-center gap-1.5 py-1 text-meta text-muted hover:text-ink">
              <ChevronDown size={13} className={showOther ? 'rotate-180' : ''} />
              {showOther ? 'Hide' : 'Show'} {unavailable.length} models unavailable on this computer
            </button>
            {showOther && <div id="other-model-list" className="mt-2 rounded-card border border-line divide-y divide-line">
              {unavailable.map((m) => <div key={m.id} data-testid="unavailable-model" className="px-4 py-3">
                <p className="font-medium text-ink-soft">{m.name}</p>
                <p className="text-ui text-muted">{m.description}</p>
                <p className="mt-0.5 text-meta text-muted">{gb(m.sizeGB)} · {m.reason === 'memory' ? 'Needs more memory than this computer has available' : 'Would respond too slowly on this computer'}</p>
              </div>)}
            </div>}
          </>}
    </>
  )
}

/** Web access: the one switch between offline and online */
export function PrivacySettings() {
  const [s, setS] = useState<UserSettings | null>(null)
  useEffect(() => { void hob.settings.get().then(setS) }, [])
  return (
    <>
      <Heading>Privacy</Heading>
      <p className="mb-2 text-meta text-muted">Hob runs on this computer. Your chats and files never leave it.</p>
      <Row label="Web access" help="Lets Hob search the web, read pages, and let its code fetch data and install Python packages. Turn it off to stay fully offline.">
        <Switch testId="web-toggle" label="Web access" on={!!s?.webAccess} onChange={(on) => s && void hob.settings.set({ webAccess: on }).then(setS)} />
      </Row>
    </>
  )
}

/** where chat files go, how much space Hob uses, and deleting every chat */
export function FilesSettings({ onAllChatsDeleted }: { onAllChatsDeleted(): void }) {
  const [s, setS] = useState<UserSettings | null>(null)
  const [storage, setStorage] = useState<StorageUsage | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [chatCount, setChatCount] = useState(0)
  const reload = () => void hob.storage.get().then(setStorage)
  useEffect(() => { reload(); void hob.settings.get().then(setS) }, [])
  return (
    <>
      <Heading>Files</Heading>
      <Row label="Chat files" help="Each chat keeps its files in its own folder here.">
        <button onClick={() => void hob.settings.pickFilesDir().then(async (d) => { if (d) setS(await hob.settings.set({ filesDir: d })) })} className={button.secondary}>Change…</button>
      </Row>
      <code data-testid="files-dir" className="block truncate rounded bg-line/50 px-2 py-1 text-meta">{s?.filesDir}</code>
      <Heading>Storage</Heading>
      <section data-testid="storage">
        <p className="mb-3 text-meta text-muted">Space used on disk, including supporting files. Sizes are rounded.</p>
        {storage && (
          <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-ui">
            <dt className="font-medium">Models & image support</dt><dd data-testid="storage-models-total" className="font-medium tabular-nums">{gb(storage.modelsGB)}</dd>
            <dt className="pl-3 text-meta text-muted">Chat models</dt><dd className="text-meta text-muted tabular-nums">{gb(storage.chatModelsGB)}</dd>
            <dt className="pl-3 text-meta text-muted">Image model & tools</dt><dd className="text-meta text-muted tabular-nums">{gb(storage.imageSupportGB)}</dd>
            <dt className="pl-3 text-meta text-muted">Voice model</dt><dd className="text-meta text-muted tabular-nums">{gb(storage.voiceModelsGB)}</dd>
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
              <p className="text-ui text-muted">Removes every chat from Hob. Files they made stay in your files folder. This can’t be undone.</p>
            </div>
            <button data-testid="delete-all-chats" onClick={() => void hob.chats.list().then((c) => { setChatCount(c.length); setConfirmDelete(true) })}
              className="shrink-0 rounded-control border border-danger/40 px-3 py-1.5 text-ui font-medium text-danger transition-colors hover:bg-danger/10">
              Delete all chats
            </button>
          </div>
        </section>
      </div>
      {confirmDelete && (
        <Dialog title={`Delete all ${chatCount} ${chatCount === 1 ? 'chat' : 'chats'}?`} testId="confirm-delete-all" onClose={() => setConfirmDelete(false)}>
          <p className="text-ui text-ink-soft">Every chat will be removed from Hob. Files they made stay in your files folder.</p>
          <p className="mt-2 text-ui font-medium">This can’t be undone.</p>
          <div className="mt-5 flex justify-end gap-2">
            <button autoFocus onClick={() => setConfirmDelete(false)} className={button.secondary}>Cancel</button>
            <button data-testid="confirm-delete-all-yes" onClick={() => { setConfirmDelete(false); void hob.chats.removeAll().then(() => { onAllChatsDeleted(); reload() }) }}
              className="inline-flex items-center rounded-control bg-danger px-3 py-1.5 text-ui font-medium text-white transition-opacity hover:opacity-90">
              Delete all chats
            </button>
          </div>
        </Dialog>
      )}
    </>
  )
}
