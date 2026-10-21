import { useEffect, useState } from 'react'
import { Cpu, FolderOpen, Monitor, Moon, Plug, Puzzle, Search, Settings as Cog, Shield, Sparkles, Sun, X } from 'lucide-react'
import type { Theme, UserSettings } from '../../../shared/agent'
import type { PluginResult } from '../../../shared/plugins'
import { hob } from '../api'
import { appearance, type TextSize } from '../appearance'
import { LANGUAGES, prefs } from '../speech/prefs'
import { FilesSettings, Heading, ModelSettings, PrivacySettings, Row, Segmented } from '../screens/Settings'
import { Plugins, type Tab } from '../screens/Plugins'

export type Section = 'general' | 'model' | 'privacy' | 'files' | Tab

const NAV: { group: string; items: { id: Section; label: string; icon: typeof Cog; words: string }[] }[] = [
  { group: 'Settings', items: [
    { id: 'general', label: 'General', icon: Cog, words: 'appearance theme dark light text size dictation voice language' },
    { id: 'model', label: 'Model', icon: Cpu, words: 'ai model download smarter images vision' },
    { id: 'privacy', label: 'Privacy', icon: Shield, words: 'web access internet offline search' },
    { id: 'files', label: 'Files & storage', icon: FolderOpen, words: 'folder storage space delete chats' },
  ] },
  { group: 'Customize', items: [
    { id: 'skills', label: 'Skills', icon: Sparkles, words: 'skills how-to slash commands' },
    { id: 'connectors', label: 'Connectors', icon: Plug, words: 'connectors apps mcp google calendar email gmail notion' },
    { id: 'plugins', label: 'Plugins', icon: Puzzle, words: 'plugins bundles tools pdf code web search' },
  ] },
]

/** theme, reply text size, and dictation */
function GeneralSettings() {
  const [s, setS] = useState<UserSettings | null>(null)
  const [size, setSize] = useState<TextSize>(appearance.textSize())
  const [language, setLanguage] = useState(prefs.language())
  useEffect(() => { void hob.settings.get().then(setS) }, [])
  return (
    <>
      <Heading>Appearance</Heading>
      <Row label="Theme">
        <Segmented<Theme> testId="theme" value={s?.theme ?? 'system'} onChange={(theme) => void hob.settings.set({ theme }).then(setS)} options={[
          { id: 'system', label: <Monitor size={15} />, title: 'Match the system' }, { id: 'light', label: <Sun size={15} />, title: 'Light' }, { id: 'dark', label: <Moon size={15} />, title: 'Dark' },
        ]} />
      </Row>
      <Row label="Text size" help="Size of Hob's replies.">
        <Segmented<TextSize> testId="text-size" value={size} onChange={(v) => { setSize(v); appearance.setTextSize(v) }} options={[
          { id: 'small', label: 'Small' }, { id: 'medium', label: 'Medium' }, { id: 'large', label: 'Large' },
        ]} />
      </Row>
      <Heading>Dictation</Heading>
      <Row label="Language" help="What you speak when you dictate. Auto works it out. Pick the microphone from the arrow next to the mic button.">
        <select data-testid="settings-dictation-language" value={language} onChange={(e) => { setLanguage(e.target.value); prefs.setLanguage(e.target.value) }}
          className="rounded-control border border-line-strong bg-surface px-2 py-1 text-ui outline-none">
          {LANGUAGES.map((l) => <option key={l.id || 'auto'} value={l.id}>{l.label}</option>)}
        </select>
      </Row>
    </>
  )
}

/** Settings and customizing, in one place over the app (the gear, or ⌘,) */
export function SettingsOverlay({ section, onSection, onClose, opened, onAllChatsDeleted }: {
  section: Section; onSection(s: Section): void; onClose(): void; opened?: PluginResult | null; onAllChatsDeleted(): void
}) {
  const [q, setQ] = useState('')
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[role=dialog]:not([data-testid=settings])')) onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  const match = (i: { label: string; words: string }) => !q.trim() || `${i.label} ${i.words}`.toLowerCase().includes(q.trim().toLowerCase())
  return (
    // starts below the title bar: the window's own buttons stay clear of it, and the strip still moves the window
    <div className="fade-in fixed inset-0 z-40 flex flex-col bg-black/30" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="drag h-11 shrink-0" />
      <div className="flex min-h-0 flex-1 px-4 pb-4 sm:px-6 sm:pb-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div data-testid="settings" role="dialog" aria-label="Settings" className="pop mx-auto flex h-full w-full max-w-5xl overflow-hidden rounded-[16px] border border-line bg-paper shadow-2xl">
        <nav className="flex w-56 shrink-0 flex-col gap-4 overflow-y-auto border-r border-line bg-sidebar p-3">
          <label className="flex items-center gap-2 rounded-control border border-line bg-surface px-2.5 py-1.5 text-ui">
            <Search size={14} className="text-muted" />
            <input data-testid="settings-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted" />
          </label>
          {NAV.map((g) => {
            const items = g.items.filter(match)
            if (!items.length) return null
            return (
              <div key={g.group}>
                <p className="px-2.5 pb-1 text-meta text-muted">{g.group}</p>
                {items.map((i) => (
                  <button key={i.id} data-testid={`settings-nav-${i.id}`} aria-current={section === i.id ? 'page' : undefined} onClick={() => onSection(i.id)}
                    className={`flex w-full items-center gap-2.5 rounded-control px-2.5 py-1.5 text-left text-ui ${section === i.id ? 'bg-line text-ink' : 'text-ink-soft hover:bg-line/60 hover:text-ink'}`}>
                    <i.icon size={16} strokeWidth={1.75} />{i.label}
                  </button>
                ))}
              </div>
            )
          })}
        </nav>
        <div className="relative min-w-0 flex-1 overflow-y-auto">
          <button data-testid="settings-close" aria-label="Close settings" title="Close (Esc)" onClick={onClose} className="absolute right-4 top-4 rounded-control p-1.5 text-muted hover:bg-line/70 hover:text-ink"><X size={16} /></button>
          <div key={section} className="fade-in mx-auto max-w-2xl px-8 pt-8 pb-12">
            {section === 'general' && <GeneralSettings />}
            {section === 'model' && <ModelSettings />}
            {section === 'privacy' && <PrivacySettings />}
            {section === 'files' && <FilesSettings onAllChatsDeleted={onAllChatsDeleted} />}
            {(section === 'skills' || section === 'connectors' || section === 'plugins') && <Plugins section={section} onSection={onSection} opened={opened} />}
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}
