import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { loadSettings, updateSettings } from './settings'

export function makePaths(userData: string) {
  const settings = join(userData, 'settings.json')
  /** models, the image model and the voice model: everything big. In app data unless another drive was picked during setup */
  let downloads = loadSettings(settings).downloadsDir ?? userData
  const p = {
    root: userData,
    settings,
    get downloads() { return downloads },
    get models() { return join(downloads, 'models') },
    catalogCache: join(userData, 'catalog.json'),
    db: join(userData, 'hob.db'),
    python: join(userData, 'python'),
    undo: join(userData, 'undo'),
    /** dictation model */
    get speech() { return join(downloads, 'speech') },
    /** scratch space for running code (scripts, matplotlib cache) */
    runTmp: join(userData, 'run-tmp'),
    /** plugins the user added */
    plugins: join(userData, 'plugins'),
    /** Hob's eyes: the vision model and llama.cpp's server */
    get vision() { return join(downloads, 'vision') },
    /** downloads go to a Hob folder there from now on (a drive with more space) */
    setDownloads(dir: string) {
      downloads = join(dir, 'Hob')
      updateSettings(settings, { downloadsDir: downloads })
      makeDownloadDirs()
    },
  }
  const makeDownloadDirs = () => {
    // a drive that isn't plugged in: setup finds no models and offers to download them again
    try { for (const d of [p.models, p.speech, p.vision]) mkdirSync(d, { recursive: true }) } catch (err) { console.warn(`couldn't use ${downloads}`, err) }
  }
  for (const d of [userData, p.python, p.undo, p.runTmp, p.plugins]) mkdirSync(d, { recursive: true })
  makeDownloadDirs()
  return p
}
export type Paths = ReturnType<typeof makePaths>
