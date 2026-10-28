import { spawn } from 'node:child_process'
import { posix, win32 } from 'node:path'

type Where = { platform: NodeJS.Platform; packaged: boolean; profile: boolean; execPath: string; appImage: string | undefined; data: string }
/** data: Hob's app data folder (models, chats, settings); app: the app itself, to the Trash; uninstaller: Windows does both */
export type Removal = { data?: string; app?: string; uninstaller?: string }

/** what "Remove Hob" takes away. Dragging Hob to the Trash can't run anything, so the multi-gigabyte models would stay behind. */
export function removalPlan(w: Where): Removal {
  // a dev build or a test profile: never touch an installed app
  if (!w.packaged || w.profile) return { data: w.data }
  if (w.platform === 'win32') return { uninstaller: win32.join(win32.dirname(w.execPath), 'Uninstall Hob.exe') }
  if (w.platform === 'darwin') return { data: w.data, app: posix.resolve(w.execPath, '../../..') }
  return { data: w.data, app: w.appImage }
}

/** deletes a folder once this process has quit, so nothing still running writes it back */
export function deleteAfterExit(dir: string) {
  const script = `const fs = require('node:fs'), [pid, dir] = process.argv.slice(1)
const gone = () => { try { process.kill(Number(pid), 0); return false } catch { return true } }
const wait = () => gone() ? fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10 }) : setTimeout(wait, 200)
wait()`
  spawn(process.execPath, ['-e', script, String(process.pid), dir], { detached: true, stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }).unref()
}
