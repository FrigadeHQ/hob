import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

export function makePaths(userData: string) {
  const p = {
    root: userData,
    models: join(userData, 'models'),
    settings: join(userData, 'settings.json'),
    catalogCache: join(userData, 'catalog.json'),
    db: join(userData, 'hob.db'),
    python: join(userData, 'python'),
    undo: join(userData, 'undo'),
    /** dictation model */
    speech: join(userData, 'speech'),
    /** scratch space for running code (scripts, matplotlib cache) */
    runTmp: join(userData, 'run-tmp'),
    /** plugins the user added */
    plugins: join(userData, 'plugins'),
    /** Hob's eyes: the vision model and llama.cpp's server */
    vision: join(userData, 'vision'),
  }
  for (const d of [p.models, p.python, p.undo, p.runTmp, p.speech, p.plugins, p.vision]) mkdirSync(d, { recursive: true })
  return p
}
export type Paths = ReturnType<typeof makePaths>
