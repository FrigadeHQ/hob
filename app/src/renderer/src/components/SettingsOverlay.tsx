import { useEffect, useState } from 'react'
import { Cpu, FolderOpen, Monitor, Moon, Plug, Puzzle, Search, Settings as Cog, Shield, Sparkles, Sun, X } from 'lucide-react'
import type { Theme, UserSettings } from '../../../shared/agent'
import type { PluginResult } from '../../../shared/plugins'
import { hob } from '../api'
import { appearance, type TextSize } from '../appearance'
import { languageOptions, prefs } from '../speech/prefs'
import { LOCALES, msg, t } from '../../../shared/i18n'
import { applyLanguage } from '../i18n'
import { FilesSettings, Heading, ModelSettings, PrivacySettings, Row, Segmented } from '../screens/Settings'
import { Plugins, type Tab } from '../screens/Plugins'

export type Section = 'general' | 'model' | 'privacy' | 'files' | Tab

const NAV: { group: string; items: { id: Section; label: string; icon: typeof Cog; words: string }[] }[] = [
  { group: msg('Settings'), items: [
    { id: 'general', label: msg('General'), icon: Cog, words: 'language appearance theme dark light text size dictation voice' },
    { id: 'model', label: msg('Model'), icon: Cpu, words: 'ai model download smarter images vision' },
    { id: 'privacy', label: msg('Privacy'), icon: Shield, words: 'web access internet offline search' },
    { id: 'files', label: msg('Files & storage'), icon: FolderOpen, words: 'folder storage space delete chats remove uninstall' },
  ] },
  { group: msg('Customize'), items: [
    { id: 'skills', label: msg('Skills'), icon: Sparkles, words: 'skills how-to slash commands' },
    { id: 'connectors', label: msg('Connectors'), icon: Plug, words: 'connectors apps mcp google calendar email gmail notion' },
    { id: 'plugins', label: msg('Plugins'), icon: Puzzle, words: 'plugins bundles tools pdf code web search' },
  ] },
]

/** theme, reply text size, and dictation */
function GeneralSettings() {
  const [s, setS] = useState<UserSettings | null>(null)
  const [size, setSize] = useState<TextSize>(appearance.textSize())
  const [language, setLanguage] = useState(prefs.language())
  useEffect(() => { void hob.settings.get().then(setS) }, [])
  const pickLanguage = (language: string) => void hob.settings.set({ language }).then((next) => { setS(next); applyLanguage(next.locale) })
  return (
    <>
      <Heading>{t('Language')}</Heading>
      <Row label={t('Language')} help={t("Hob's menus and buttons. Hob answers in the language you write in.")}>
        <select data-testid="settings-language" value={s?.language ?? ''} onChange={(e) => pickLanguage(e.target.value)}
          className="rounded-control border border-line-strong bg-surface px-2 py-1 text-ui outline-none">
          <option value="">{t('Same as computer ({name})', { name: LOCALES.find((l) => l.id === s?.systemLocale)?.name ?? 'English' })}</option>
          {LOCALES.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </Row>
      <Heading>{t('Appearance')}</Heading>
      <Row label={t('Theme')}>
        <Segmented<Theme> testId="theme" value={s?.theme ?? 'system'} onChange={(theme) => void hob.settings.set({ theme }).then(setS)} options={[
          { id: 'system', label: <Monitor size={15} />, title: t('Match the system') }, { id: 'light', label: <Sun size={15} />, title: t('Light') }, { id: 'dark', label: <Moon size={15} />, title: t('Dark') },
        ]} />
      </Row>
      <Row label={t('Reply text size')} help={t("Changes Hob's replies in chat.")}>
        <Segmented<TextSize> testId="text-size" value={size} onChange={(v) => { setSize(v); appearance.setTextSize(v) }} options={[
          { id: 'small', label: t('Small') }, { id: 'medium', label: t('Medium') }, { id: 'large', label: t('Large') },
        ]} />
      </Row>
      <div className="mt-3 rounded-card border border-line bg-surface px-4 py-3">
        <p className="mb-2 text-meta text-muted">{t('Reply preview')}</p>
        <div data-testid="reply-size-preview" className="reply prose max-w-none">{t('Here’s a quick summary of what I found.')}</div>
      </div>
      <Heading>{t('Dictation')}</Heading>
      <Row label={t('Language')} help={t('What you speak when you dictate. Auto works it out. Pick the microphone from the arrow next to the mic button.')}>
        <select data-testid="settings-dictation-language" value={language} onChange={(e) => { setLanguage(e.target.value); prefs.setLanguage(e.target.value) }}
          className="rounded-control border border-line-strong bg-surface px-2 py-1 text-ui outline-none">
          {languageOptions().map((l) => <option key={l.id || 'auto'} value={l.id}>{l.label}</option>)}
        </select>
      </Row>
    </>
  )
}

/** Settings and customizing, in one place over the app (the gear, or ⌘,) */
export function SettingsOverlay({ section, onSection, onClose, opened, onAllChatsDeleted, onTryPrompt }: {
  section: Section; onSection(s: Section): void; onClose(): void; opened?: PluginResult | null; onAllChatsDeleted(): void; onTryPrompt(prompt: string): void
}) {
  const [q, setQ] = useState('')
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[role=dialog]:not([data-testid=settings])')) onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  // the name in the interface's language, and the English name and words
  const match = (i: { label: string; words: string }) => !q.trim() || `${t(i.label)} ${i.label} ${i.words}`.toLowerCase().includes(q.trim().toLowerCase())
  return (
    // starts below the title bar: the window's own buttons stay clear of it, and the strip still moves the window
    <div data-scrim className="scrim fade-in fixed inset-0 z-40 flex flex-col" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="drag h-12 shrink-0" />
      <div className="flex min-h-0 flex-1 px-4 pb-4 sm:px-6 sm:pb-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div data-testid="settings" role="dialog" aria-label={t('Settings')} className="pop mx-auto flex h-full w-full max-w-5xl overflow-hidden rounded-[16px] border border-line bg-paper shadow-2xl">
        <nav className="flex w-56 shrink-0 flex-col gap-4 overflow-y-auto border-e border-line bg-sidebar p-3">
          <label className="flex items-center gap-2 rounded-control border border-line bg-surface px-2.5 py-1.5 text-ui">
            <Search size={14} className="text-muted" />
            <input data-testid="settings-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search')} className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted" />
          </label>
          {NAV.map((g) => {
            const items = g.items.filter(match)
            if (!items.length) return null
            return (
              <div key={g.group}>
                <p className="px-2.5 pb-1 text-meta text-muted">{t(g.group)}</p>
                {items.map((i) => (
                  <button key={i.id} data-testid={`settings-nav-${i.id}`} aria-current={section === i.id ? 'page' : undefined} onClick={() => onSection(i.id)}
                    className={`flex w-full items-center gap-2.5 rounded-control px-2.5 py-1.5 text-start text-ui ${section === i.id ? 'bg-line text-ink' : 'text-ink-soft hover:bg-line/60 hover:text-ink'}`}>
                    <i.icon size={16} strokeWidth={1.75} />{t(i.label)}
                  </button>
                ))}
              </div>
            )
          })}
        </nav>
        <div className="relative min-w-0 flex-1 overflow-y-auto">
          <button data-testid="settings-close" aria-label={t('Close settings')} title={t('Close (Esc)')} onClick={onClose} className="no-drag absolute end-4 top-4 z-10 rounded-control p-1.5 text-muted hover:bg-line/70 hover:text-ink"><X size={16} /></button>
          <div key={section} className="fade-in mx-auto max-w-2xl px-8 pt-8 pb-12">
            {section === 'general' && <GeneralSettings />}
            {section === 'model' && <ModelSettings />}
            {section === 'privacy' && <PrivacySettings />}
            {section === 'files' && <FilesSettings onAllChatsDeleted={onAllChatsDeleted} />}
            {(section === 'skills' || section === 'connectors' || section === 'plugins') && <Plugins section={section} onSection={onSection} opened={opened} onTryPrompt={onTryPrompt} />}
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}
