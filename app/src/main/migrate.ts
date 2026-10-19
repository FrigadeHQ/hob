import { existsSync, renameSync } from 'node:fs'
import { join, sep } from 'node:path'
import type { Store } from './store'

/** The app was called Thrum before Hob: carry an existing profile over, once, never over a newer one. */
export function migrateProfile(appData: string) {
  const from = join(appData, 'Thrum')
  const to = join(appData, 'Hob')
  if (!existsSync(from) || existsSync(to)) return
  renameSync(from, to)
  for (const ext of ['', '-wal', '-shm']) {
    if (existsSync(join(to, `thrum.db${ext}`))) renameSync(join(to, `thrum.db${ext}`), join(to, `hob.db${ext}`))
  }
}

/** Move the chat files folder (e.g. ~/Documents/Thrum → ~/Documents/Hob) and repoint saved chats. */
export function migrateFilesDir(from: string, to: string, store: Store) {
  if (!existsSync(from) || existsSync(to)) return
  renameSync(from, to)
  store.movePaths(from + sep, to + sep)
}
