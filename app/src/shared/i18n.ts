/**
 * The interface in the user's language. English text is the key: t('New chat') looks it up in the
 * language's table and falls back to the English. Tables live in shared/locales/<id>.json; en.json
 * holds only the English plural forms. Blanks are {name}; a value with plural forms picks one by {count}.
 */
export type Locale = { id: string; name: string; english: string; rtl?: boolean }
export type Entry = string | Partial<Record<Intl.LDMLPluralRule, string>>
export type Table = Record<string, Entry>
export type Vars = Record<string, string | number>

/** The languages dictation knows, and the other big ones. English first, then by English name */
export const LOCALES: Locale[] = [
  { id: 'en', name: 'English', english: 'English' },
  { id: 'ar', name: 'العربية', english: 'Arabic', rtl: true },
  { id: 'bn', name: 'বাংলা', english: 'Bengali' },
  { id: 'zh-CN', name: '简体中文', english: 'Chinese (Simplified)' },
  { id: 'zh-TW', name: '繁體中文', english: 'Chinese (Traditional)' },
  { id: 'cs', name: 'Čeština', english: 'Czech' },
  { id: 'da', name: 'Dansk', english: 'Danish' },
  { id: 'nl', name: 'Nederlands', english: 'Dutch' },
  { id: 'fil', name: 'Filipino', english: 'Filipino' },
  { id: 'fi', name: 'Suomi', english: 'Finnish' },
  { id: 'fr', name: 'Français', english: 'French' },
  { id: 'de', name: 'Deutsch', english: 'German' },
  { id: 'el', name: 'Ελληνικά', english: 'Greek' },
  { id: 'he', name: 'עברית', english: 'Hebrew', rtl: true },
  { id: 'hi', name: 'हिन्दी', english: 'Hindi' },
  { id: 'hu', name: 'Magyar', english: 'Hungarian' },
  { id: 'id', name: 'Bahasa Indonesia', english: 'Indonesian' },
  { id: 'it', name: 'Italiano', english: 'Italian' },
  { id: 'ja', name: '日本語', english: 'Japanese' },
  { id: 'ko', name: '한국어', english: 'Korean' },
  { id: 'ms', name: 'Bahasa Melayu', english: 'Malay' },
  { id: 'nb', name: 'Norsk', english: 'Norwegian' },
  { id: 'pl', name: 'Polski', english: 'Polish' },
  { id: 'pt-BR', name: 'Português', english: 'Portuguese' },
  { id: 'ro', name: 'Română', english: 'Romanian' },
  { id: 'ru', name: 'Русский', english: 'Russian' },
  { id: 'es', name: 'Español', english: 'Spanish' },
  { id: 'sv', name: 'Svenska', english: 'Swedish' },
  { id: 'th', name: 'ไทย', english: 'Thai' },
  { id: 'tr', name: 'Türkçe', english: 'Turkish' },
  { id: 'uk', name: 'Українська', english: 'Ukrainian' },
  { id: 'vi', name: 'Tiếng Việt', english: 'Vietnamese' },
]
export const isLocale = (id: unknown): id is string => typeof id === 'string' && LOCALES.some((l) => l.id === id)
export const dirOf = (id: string): 'rtl' | 'ltr' => (LOCALES.find((l) => l.id === id)?.rtl ? 'rtl' : 'ltr')

// other codes systems use for the same language
const ALIASES: Record<string, string> = { no: 'nb', nn: 'nb', tl: 'fil', iw: 'he', in: 'id', pt: 'pt-BR', zh: 'zh-CN' }
const TRADITIONAL = /^zh-(hant|tw|hk|mo)\b/

/** The first of the computer's languages that Hob has; English when none */
export function matchLocale(preferred: readonly string[]): string {
  for (const raw of preferred) {
    const tag = raw.replace(/_/g, '-').toLowerCase()
    if (tag.startsWith('zh')) return TRADITIONAL.test(tag) ? 'zh-TW' : 'zh-CN'
    const exact = LOCALES.find((l) => l.id.toLowerCase() === tag)
    if (exact) return exact.id
    const base = tag.split('-')[0]
    const id = ALIASES[base] ?? base
    if (isLocale(id)) return id
  }
  return 'en'
}

const tables: Record<string, Table> = Object.fromEntries(
  Object.entries(import.meta.glob<Table>('./locales/*.json', { eager: true, import: 'default' }))
    .map(([path, table]) => [path.replace(/^.*\/|\.json$/g, ''), table]),
)

/** One lookup: the language's entry, else English; a plural picked by count; blanks filled */
export function translate(source: Record<string, Table>, lang: string, text: string, vars?: Vars): string {
  let entry = source[lang]?.[text] ?? source.en?.[text] ?? text
  if (typeof entry !== 'string') {
    const n = typeof vars?.count === 'number' ? vars.count : 0
    entry = entry[new Intl.PluralRules(lang).select(n)] ?? entry.other ?? text
  }
  if (!vars) return entry
  return entry.replace(/\{(\w+)\}/g, (all, k: string) => {
    const v = vars[k]
    return v === undefined ? all : typeof v === 'number' ? new Intl.NumberFormat(lang).format(v) : v
  })
}

let current = 'en'
const listeners = new Set<() => void>()

export const language = () => current
export function setLanguage(id: string) {
  const next = isLocale(id) ? id : 'en'
  if (next === current) return
  current = next
  for (const l of listeners) l()
}
export function onLanguage(l: () => void) {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

/** The text in the current language */
export const t = (text: string, vars?: Vars) => translate(tables, current, text, vars)
/** Marks text to translate where it's shown (lists and constants); returns it unchanged */
export const msg = (text: string) => text
