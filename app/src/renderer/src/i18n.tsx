import { Fragment, useSyncExternalStore, type ReactNode } from 'react'
import { dirOf, language, onLanguage, setLanguage, t } from '../../shared/i18n'

/** The interface's language, with the page's lang and direction to match (Arabic and Hebrew read right to left) */
export function applyLanguage(id: string) {
  setLanguage(id)
  document.documentElement.lang = language()
  document.documentElement.dir = dirOf(language())
}

/** Re-renders when the language changes */
export const useLanguage = () => useSyncExternalStore(onLanguage, language)

/** t() with parts that are elements: tx('Move {file} to the Trash?', { file: <b>{name}</b> }) */
export function tx(text: string, parts: Record<string, ReactNode>): ReactNode[] {
  const plain = Object.fromEntries(Object.keys(parts).map((k) => [k, `\u0000${k}\u0000`]))
  return t(text, plain).split('\u0000').map((piece, i) => (i % 2 ? <Fragment key={i}>{parts[piece]}</Fragment> : piece))
}
