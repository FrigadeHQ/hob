import { existsSync, renameSync } from 'node:fs'
import { join, sep } from 'node:path'
import type { Store } from './store'

/** The app was called Hob (and before that Thrum): carry an existing profile over, once, never over a newer one. */
export function migrateProfile(appData: string) {
  const to = join(appData, 'Mabel')
  if (existsSync(to)) return
  // the app's earlier names, newest first: Hob, then Thrum
  for (const [name, db] of [['Hob', 'hob.db'], ['Thrum', 'thrum.db']]) {
    const from = join(appData, name)
    if (!existsSync(from)) continue
    renameSync(from, to)
    for (const ext of ['', '-wal', '-shm']) {
      if (existsSync(join(to, `${db}${ext}`))) renameSync(join(to, `${db}${ext}`), join(to, `mabel.db${ext}`))
    }
    return
  }
}

/** Move the chat files folder (e.g. ~/Documents/Thrum → ~/Documents/Mabel) and repoint saved chats. */
export function migrateFilesDir(from: string, to: string, store: Store) {
  if (!existsSync(from) || existsSync(to)) return
  renameSync(from, to)
  store.movePaths(from + sep, to + sep)
}
