import { useEffect, useState } from 'react'
import type { ModelRow, UserSettings } from '../../../shared/agent'
import type { SetupState } from '../../../shared/types'
import { hob } from '../api'
import { Dialog, Switch, button } from '../components/ui'

const gb = (n: number) => (n < 10 ? `${n.toFixed(1)} GB` : `${Math.round(n)} GB`)
const left = (s: number) => (s <= 0 ? '' : s < 90 ? ' · about a minute left' : s < 5400 ? ` · about ${Math.round(s / 60)} minutes left` : ` · about ${Math.round(s / 3600)} hours left`)

export function Settings({ onAllChatsDeleted }: { onAllChatsDeleted(): void }) {
  const [models, setModels] = useState<ModelRow[]>([])
  const [s, setS] = useState<UserSettings | null>(null)
  const [storage, setStorage] = useState<{ modelsGB: number; filesGB: number; codeToolsGB: number } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [chatCount, setChatCount] = useState(0)
  /** the download in progress (or about to start, the moment Download is clicked) */
  const [setup, setSetup] = useState<SetupState | null>(null)
  const [starting, setStarting] = useState<string | null>(null)
  const reload = () => { void hob.models.list().then(setModels); void hob.storage.get().then(setStorage) }
  useEffect(() => {
    reload()
    void hob.settings.get().then(setS)
    void hob.setup.getState().then(setSetup)
    return hob.setup.onState((st) => { setSetup(st); if (st.phase !== 'downloading') setStarting(null); reload() })
  }, [])
  const downloading = setup?.phase === 'downloading' ? setup : null
  const busyId = downloading?.target.id ?? starting
  function use(id: string) {
    if (busyId) return
    setStarting(id)
    void hob.models.use(id).then(reload).finally(() => setStarting((cur) => (cur === id ? null : cur)))
  }

  return (
    <main data-testid="settings" className="flex-1 overflow-y-auto">
      <div className="drag h-12" />
      <div className="max-w-2xl mx-auto px-6 pb-12 space-y-10">
        <h1 className="text-title font-semibold tracking-tight">Settings</h1>

        <section>
          <h2 className="text-body font-medium mb-3">Model</h2>
          <div className="rounded-card border border-line bg-surface divide-y divide-line">
            {models.filter((m) => m.available).map((m) => (
              <div key={m.id} data-testid="settings-model" className="flex items-start gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium">
                    {m.name}
                    {m.active && <span className="ml-2 rounded-full bg-line px-2 text-meta font-normal leading-5 text-ink-soft">In use</span>}
                  </p>
                  <p className="text-ui text-muted">{m.description}</p>
                  <p className="text-meta text-muted mt-0.5">{m.blurb} · {gb(m.sizeGB)}{m.downloaded ? ' · downloaded' : ''}</p>
                </div>
                {busyId === m.id && !m.active ? (
                  <div data-testid="model-progress" className="w-44 shrink-0 pt-1">
                    <p className="text-meta text-ink-soft">
                      {downloading && downloading.target.id === m.id
                        ? `Downloading… ${Math.min(99, Math.floor(downloading.progress * 100))}%${left(downloading.etaSec)}`
                        : m.downloaded ? 'Switching…' : 'Starting…'}
                    </p>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line">
                      <div className="h-full rounded-full bg-ink transition-[width] duration-500" style={{ width: `${downloading && downloading.target.id === m.id ? Math.max(3, downloading.progress * 100) : 3}%` }} />
                    </div>
                  </div>
                ) : !m.active && (
                  <button data-testid="model-use" disabled={!!busyId} title={busyId ? 'Wait for the current download to finish' : undefined} onClick={() => use(m.id)} className={button.secondary}>
                    {m.downloaded ? 'Use' : 'Download'}
                  </button>
                )}
                {m.downloaded && !m.active && busyId !== m.id && (
                  <button data-testid="model-delete" onClick={() => void hob.models.remove(m.id).then(reload)} className="text-ui text-muted hover:text-ink py-1.5">Delete</button>
                )}
              </div>
            ))}
          </div>
          {models.some((m) => !m.available) && (
            <p className="mt-2 text-meta text-muted">{models.filter((m) => !m.available).length} more models need a more powerful computer.</p>
          )}
        </section>

        <section className="flex items-start justify-between gap-6">
          <div>
            <h2 className="text-body font-medium">Web access</h2>
            <p className="text-ui text-muted">Lets Hob search the web and read pages when it helps. Searches go to public search engines; nothing else leaves your computer.</p>
          </div>
          <div className="mt-1"><Switch testId="web-toggle" label="Web access" on={!!s?.webAccess} onChange={(on) => s && void hob.settings.set({ webAccess: on }).then(setS)} /></div>
        </section>

        <section>
          <h2 className="text-body font-medium">Files</h2>
          <p className="text-ui text-muted">Each chat keeps its files in its own folder here.</p>
          <div className="mt-2 flex items-center gap-3 text-ui">
            <code data-testid="files-dir" className="flex-1 min-w-0 truncate rounded bg-line/50 px-2 py-1">{s?.filesDir}</code>
            <button
              onClick={() => void hob.settings.pickFilesDir().then(async (d) => { if (d) setS(await hob.settings.set({ filesDir: d })) })}
              className={button.secondary}
            >
              Change…
            </button>
          </div>
        </section>

        <section data-testid="storage">
          <h2 className="text-body font-medium mb-2">Storage</h2>
          {storage && (
            <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-ui">
              <dt className="text-muted">Models</dt><dd>{gb(storage.modelsGB)}</dd>
              <dt className="text-muted">Chat files</dt><dd>{gb(storage.filesGB)}</dd>
              <dt className="text-muted">Code tools</dt><dd>{gb(storage.codeToolsGB)}</dd>
            </dl>
          )}
        </section>

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
    </main>
  )
}
