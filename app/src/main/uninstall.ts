import { spawn } from 'node:child_process'
import { posix, win32 } from 'node:path'

type Where = { platform: NodeJS.Platform; packaged: boolean; profile: boolean; execPath: string; appImage: string | undefined; data: string; downloads: string }
/** folders: deleted once Hob has quit (app data, models on another drive); app: the app itself, to the Trash; uninstaller: Windows' own, which takes app data too */
export type Removal = { folders: string[]; app?: string; uninstaller?: string }

/** what "Remove Hob" takes away. Dragging Hob to the Trash can't run anything, so the multi-gigabyte models would stay behind. */
export function removalPlan(w: Where): Removal {
  const elsewhere = w.downloads !== w.data ? [w.downloads] : []
  // a dev build or a test profile: never touch an installed app
  if (!w.packaged || w.profile) return { folders: [w.data, ...elsewhere] }
  if (w.platform === 'win32') return { folders: elsewhere, uninstaller: win32.join(win32.dirname(w.execPath), 'Uninstall Hob.exe') }
  if (w.platform === 'darwin') return { folders: [w.data, ...elsewhere], app: posix.resolve(w.execPath, '../../..') }
  return { folders: [w.data, ...elsewhere], app: w.appImage }
}

/** once this process has quit, so nothing still running writes them back or holds a model open: delete the folders, then run the uninstaller */
export function removeAfterExit(folders: string[], uninstaller?: string) {
  const script = `const fs = require('node:fs'), { spawn } = require('node:child_process')
const [pid, uninstaller, ...folders] = process.argv.slice(1)
const gone = () => { try { process.kill(Number(pid), 0); return false } catch { return true } }
const wait = () => {
  if (!gone()) return setTimeout(wait, 200)
  for (const f of folders) fs.rmSync(f, { recursive: true, force: true, maxRetries: 10 })
  if (uninstaller) spawn(uninstaller, ['/S', '--delete-app-data'], { detached: true, stdio: 'ignore' }).unref()
}
wait()`
  spawn(process.execPath, ['-e', script, String(process.pid), uninstaller ?? '', ...folders], { detached: true, stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }).unref()
}
