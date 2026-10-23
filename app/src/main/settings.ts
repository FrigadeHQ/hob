import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { DEFAULT_EFFORT, isEffort, type Effort } from '../shared/effort'

/** pendingModelId: a model download that was still in progress when Hob last ran */
/** theme: light or dark regardless of the system; follows the system when left out. effort: how long Hob thinks */
export type Settings = { activeModelId?: string; pendingModelId?: string; webAccess?: boolean; filesDir?: string; theme?: 'light' | 'dark'; effort?: Effort }

export function loadSettings(path: string): Settings {
  try { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {} } catch { return {} }
}
export function saveSettings(path: string, s: Settings) {
  // write-then-rename so a crash mid-save never leaves a half-written file
  writeFileSync(path + '.tmp', JSON.stringify(s, null, 2))
  renameSync(path + '.tmp', path)
}

/** Merge a patch into the saved settings; undefined values remove a key. */
export function updateSettings(path: string, patch: Partial<Settings>): Settings {
  const next = { ...loadSettings(path), ...patch }
  saveSettings(path, next)
  return next
}

/** Web search is on unless the user switched it off. */
export const webAccessOn = (s: Settings) => s.webAccess !== false

/** Normal unless the user picked another */
export const effortOf = (s: Settings): Effort => (isEffort(s.effort) ? s.effort : DEFAULT_EFFORT)
