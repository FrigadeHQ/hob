import { language, msg, t } from '../../../shared/i18n'

/** Which microphone and language dictation uses: this computer's choice, kept in the browser's storage. */
/** code: the ISO code, for the name in the interface's language; label: the English name, if that's missing */
export type Language = { id: string; label: string; code?: string }
/** Whisper's names for the languages it knows best; '' = work it out from the speech */
export const LANGUAGES: Language[] = [
  { id: '', label: msg('Auto') }, { id: 'english', label: 'English', code: 'en' }, { id: 'spanish', label: 'Spanish', code: 'es' }, { id: 'french', label: 'French', code: 'fr' },
  { id: 'german', label: 'German', code: 'de' }, { id: 'italian', label: 'Italian', code: 'it' }, { id: 'portuguese', label: 'Portuguese', code: 'pt' }, { id: 'dutch', label: 'Dutch', code: 'nl' },
  { id: 'danish', label: 'Danish', code: 'da' }, { id: 'swedish', label: 'Swedish', code: 'sv' }, { id: 'norwegian', label: 'Norwegian', code: 'no' }, { id: 'polish', label: 'Polish', code: 'pl' },
  { id: 'turkish', label: 'Turkish', code: 'tr' }, { id: 'russian', label: 'Russian', code: 'ru' }, { id: 'ukrainian', label: 'Ukrainian', code: 'uk' }, { id: 'arabic', label: 'Arabic', code: 'ar' },
  { id: 'hindi', label: 'Hindi', code: 'hi' }, { id: 'japanese', label: 'Japanese', code: 'ja' }, { id: 'korean', label: 'Korean', code: 'ko' }, { id: 'chinese', label: 'Chinese', code: 'zh' },
  { id: 'indonesian', label: 'Indonesian', code: 'id' }, { id: 'vietnamese', label: 'Vietnamese', code: 'vi' }, { id: 'thai', label: 'Thai', code: 'th' }, { id: 'czech', label: 'Czech', code: 'cs' },
  { id: 'greek', label: 'Greek', code: 'el' }, { id: 'romanian', label: 'Romanian', code: 'ro' }, { id: 'hungarian', label: 'Hungarian', code: 'hu' }, { id: 'finnish', label: 'Finnish', code: 'fi' },
  { id: 'hebrew', label: 'Hebrew', code: 'he' }, { id: 'bengali', label: 'Bengali', code: 'bn' }, { id: 'malay', label: 'Malay', code: 'ms' }, { id: 'tagalog', label: 'Tagalog', code: 'tl' },
]

/** a language's name in the interface's language */
export function languageName(l: Language): string {
  if (!l.code) return t(l.label)
  try { return new Intl.DisplayNames([language()], { type: 'language' }).of(l.code) ?? l.label } catch { return l.label }
}

/** the dictation languages to show: Auto first, the rest by name in the interface's language */
export function languageOptions(): { id: string; label: string }[] {
  const [auto, ...rest] = LANGUAGES.map((l) => ({ id: l.id, label: languageName(l) }))
  return [auto, ...rest.sort((a, b) => a.label.localeCompare(b.label, language()))]
}
const get = (k: string) => { try { return localStorage.getItem(k) ?? '' } catch { return '' } }
const set = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private window: just for this session */ } }
export const prefs = {
  mic: () => get('hob-mic') || 'default',
  setMic: (id: string) => set('hob-mic', id),
  language: () => get('hob-dictation-language'),
  setLanguage: (id: string) => set('hob-dictation-language', id),
}
