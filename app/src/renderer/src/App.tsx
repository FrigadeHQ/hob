import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, PanelLeft, Search } from 'lucide-react'
import type { SetupState } from '../../shared/types'
import { hob } from './api'
import { Onboarding } from './screens/Onboarding'
import { ChatView } from './screens/Chat'
import { ConfirmHost } from './components/Confirm'
import { Settings } from './screens/Settings'
import { Plugins } from './screens/Plugins'
import type { PluginResult } from '../../shared/plugins'
import { Sidebar } from './components/Sidebar'
import { IconButton } from './components/ui'
import { CommandBar, MOD } from './components/CommandBar'
import { ProjectDialog } from './components/ProjectDialog'
import type { Project } from '../../shared/agent'

export type Screen = 'chat' | 'settings' | 'plugins'
/** where the user was, for back and forward; project: a new chat waiting to start in it */
type Place = { screen: Screen; chat: string | null; project?: string | null }
/** below this the sidebar folds away and opens over the chat */
const NARROW = '(max-width: 819px)'

function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches)
  useEffect(() => {
    const m = window.matchMedia(NARROW)
    const on = () => setNarrow(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return narrow
}

export function App() {
  const [state, setState] = useState<SetupState>({ phase: 'probing' })
  const [selected, setSelected] = useState<string | null>(null)
  /** bumps when the user switches chats, so the chat view starts fresh */
  const [viewKey, setViewKey] = useState(0)
  /** bumps when chats change, so the sidebar reloads */
  const [refreshKey, setRefreshKey] = useState(0)
  const [screen, setScreen] = useState<Screen>('chat')
  /** the project a new (not yet sent) chat starts in */
  const [draftProject, setDraftProject] = useState<string | null>(null)
  /** project: editing it; folders: a new one starting with these */
  const [projectDialog, setProjectDialog] = useState<{ project?: Project; folders?: string[] } | null>(null)
  const narrow = useNarrow()
  const [sidebar, setSidebar] = useState(!narrow)
  useEffect(() => setSidebar(!narrow), [narrow])
  useEffect(() => {
    void hob.setup.getState().then(setState)
    return hob.setup.onState(setState)
  }, [])
  // a .mcpb or plugin zip opened from Finder: show it on the Plugins screen
  const [opened, setOpened] = useState<PluginResult | null>(null)
  useEffect(() => hob.plugins.onOpened((r) => { setOpened(r); setScreen('plugins') }), [])
  // a plugin opened from Finder is announced once; leaving the page forgets it
  useEffect(() => { if (screen !== 'plugins') setOpened(null) }, [screen])
  // a file dropped anywhere outside the chat must never navigate the window
  useEffect(() => {
    const stop = (e: DragEvent) => e.preventDefault()
    window.addEventListener('dragover', stop)
    window.addEventListener('drop', stop)
    return () => { window.removeEventListener('dragover', stop); window.removeEventListener('drop', stop) }
  }, [])

  // back and forward, like a browser
  const history = useRef<{ list: Place[]; i: number }>({ list: [{ screen: 'chat', chat: null }], i: 0 })
  const [, setHistoryTick] = useState(0)
  const show = (p: Place, fresh = false) => {
    // a new chat starts empty; the chat it replaces keeps running in the background
    if (fresh || p.chat !== selected) { setSelected(p.chat); setDraftProject(p.project ?? null); setViewKey((k) => k + 1) }
    setScreen(p.screen)
    if (narrow) setSidebar(false)
  }
  const visit = (p: Place, fresh = false) => {
    const h = history.current
    const here = h.list[h.i]
    if (here.screen !== p.screen || here.chat !== p.chat || (p.chat === null && (here.project ?? null) !== (p.project ?? null))) {
      h.list = [...h.list.slice(0, h.i + 1), p]
      h.i = h.list.length - 1
      setHistoryTick((t) => t + 1)
    }
    show(p, fresh)
  }
  const step = async (by: -1 | 1) => {
    const h = history.current
    const alive = new Set((await hob.chats.list()).map((c) => c.id))
    // skip chats deleted since
    let i = h.i + by
    while (i >= 0 && i < h.list.length && h.list[i].chat && !alive.has(h.list[i].chat!)) i += by
    if (i < 0 || i >= h.list.length) return
    h.i = i
    setHistoryTick((t) => t + 1)
    show(h.list[i])
  }
  const go = (s: Screen) => visit({ screen: s, chat: selected })
  const open = (id: string | null, project: string | null = null) => visit({ screen: 'chat', chat: id, project }, id === null)
  const [palette, setPalette] = useState(false)
  // a ref so the shortcut handler always calls the latest closures
  const keys = useRef<(e: KeyboardEvent) => void>(() => {})
  keys.current = (e) => {
    if (!(hob.platform === 'darwin' ? e.metaKey : e.ctrlKey) || e.altKey || e.shiftKey) return
    const k = e.key.toLowerCase()
    if (k === 'k') { e.preventDefault(); setPalette((p) => !p) }
    else if (k === 'n') { e.preventDefault(); setPalette(false); open(null) }
    else if (k === ',') { e.preventDefault(); setPalette(false); go('settings') }
    else if (k === '[') { e.preventDefault(); void step(-1) }
    else if (k === ']') { e.preventDefault(); void step(1) }
  }
  useEffect(() => {
    const k = (e: KeyboardEvent) => keys.current(e)
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])

  const chatReady = state.phase === 'ready' || (state.phase === 'downloading' && state.chatReady)
  if (!chatReady) return <Onboarding state={state} />
  const mac = hob.platform === 'darwin'
  return (
    <div className="reveal relative h-full flex">
      <ConfirmHost />
      {sidebar && narrow && <div className="fade-in absolute inset-0 z-20 bg-black/20" onClick={() => setSidebar(false)} />}
      {sidebar && (
        <div className={narrow ? 'absolute inset-y-0 left-0 z-30 flex shadow-xl' : 'flex'}>
          <Sidebar state={state} selected={selected} refreshKey={refreshKey} screen={screen} draftProject={draftProject}
            onSelect={(id) => open(id)} onNew={() => open(null)} onNewInProject={(id) => open(null, id)}
            onEditProject={(p) => setProjectDialog(p ? { project: p } : {})}
            onSettings={() => go('settings')} onPlugins={() => go('plugins')} />
        </div>
      )}
      {screen === 'settings' && <Settings onAllChatsDeleted={() => {
        // nothing to go back to
        history.current = { list: [{ screen: 'settings', chat: null }], i: 0 }
        setSelected(null); setViewKey((k) => k + 1); setRefreshKey((k) => k + 1)
      }} />}
      {screen === 'plugins' && <Plugins opened={opened} />}
      {/* stays mounted under other screens: unmounting a chat stops its reply */}
      <div className={screen === 'chat' ? 'contents' : 'hidden'}>
        <ChatView key={viewKey} chatId={selected} projectId={draftProject} onProjectChange={(id) => { setDraftProject(id); const h = history.current; h.list[h.i] = { ...h.list[h.i], project: id } }}
          onNewProject={(folders) => setProjectDialog({ folders })} onChatChanged={(id) => { setSelected(id); setRefreshKey((k) => k + 1); const h = history.current; h.list[h.i] = { ...h.list[h.i], chat: id } }} onRefresh={() => setRefreshKey((k) => k + 1)} />
      </div>
      {/* next to the window buttons, like Notes and Mail. Last in the page on purpose:
          Electron lets the later of overlapping drag/no-drag areas win, so before the
          drag strips the button can't be clicked */}
      <div className={`absolute top-2.5 z-40 flex items-center ${mac ? 'left-[86px]' : 'left-2'}`}>
        <IconButton icon={PanelLeft} label={sidebar ? 'Hide sidebar' : 'Show sidebar'} testId="toggle-sidebar" size={15} small onClick={() => setSidebar((s) => !s)} />
        <IconButton icon={Search} label={`Search (${MOD}K)`} testId="open-search" size={15} small onClick={() => setPalette(true)} />
        <IconButton icon={ArrowLeft} label={`Back (${MOD}[)`} testId="go-back" size={15} small disabled={history.current.i === 0} onClick={() => void step(-1)} />
        <IconButton icon={ArrowRight} label={`Forward (${MOD}])`} testId="go-forward" size={15} small disabled={history.current.i >= history.current.list.length - 1} onClick={() => void step(1)} />
      </div>
      {palette && <CommandBar onClose={() => setPalette(false)} onOpenChat={(id) => open(id)} onNew={() => open(null)} onNewInProject={(id) => open(null, id)}
        onNewProject={() => setProjectDialog({})} onPlugins={() => go('plugins')} onSettings={() => go('settings')} />}
      {projectDialog && (
        <ProjectDialog project={projectDialog.project} folders={projectDialog.folders} onClose={() => setProjectDialog(null)} onDone={(id) => {
          const editing = projectDialog.project
          setProjectDialog(null)
          setRefreshKey((k) => k + 1)
          // a new project: start a chat in it. A removed one: leave its empty new chat
          if (id && !editing) {
            // an unsent new chat on screen moves into it, keeping what was typed
            if (screen === 'chat' && selected === null) { setDraftProject(id); const h = history.current; h.list[h.i] = { ...h.list[h.i], project: id } }
            else open(null, id)
          }
          else if (!id && editing && selected === null && draftProject === editing.id) open(null)
        }} />
      )}
    </div>
  )
}
