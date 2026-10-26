import { Notification } from 'electron'
import { t } from '../shared/i18n'

/** checking again while Hob stays open for days */
const EVERY_MS = 4 * 60 * 60 * 1000

/**
 * Installed copies update themselves from GitHub Releases. Not while developing or testing, and on Linux
 * only the AppImage can replace itself.
 */
export function updatesOn(o: { packaged: boolean; fake: boolean; profile: boolean; platform: NodeJS.Platform; appImage: boolean }): boolean {
  if (!o.packaged || o.fake || o.profile) return false
  return o.platform !== 'linux' || o.appImage
}

/** Downloads a new version in the background; it installs the next time Hob quits. */
export async function startUpdates(): Promise<void> {
  // loaded here: it reads Electron's app as it loads, which tests don't have
  const { autoUpdater } = (await import('electron-updater')).default
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = null
  autoUpdater.on('error', (err) => console.warn('checking for a new version failed', err.message))
  autoUpdater.on('update-downloaded', (info) => {
    if (!Notification.isSupported()) return
    new Notification({ title: t('Hob {version} is ready', { version: info.version }), body: t('It installs the next time you quit Hob.') }).show()
  })
  const check = () => { autoUpdater.checkForUpdates().catch(() => {}) }
  setTimeout(check, 30_000)
  setInterval(check, EVERY_MS)
}
