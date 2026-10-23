// Every English text the app shows, for the translation tables: t('…'), tx('…') and msg('…') in the source,
// plus the names, descriptions and starter titles of the built-in plugins and of the models in the catalog.
// node scripts/i18n-keys.mjs prints them as a JSON list.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const app = join(dirname(fileURLToPath(import.meta.url)), '..')
const CALL = /(?<![\w.$])(?:t|tx|msg)\(\s*('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\$]|\\.)*`)/g

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === 'locales' || name === 'node_modules' ? [] : files(p)
    return /\.tsx?$/.test(name) && !name.endsWith('.d.ts') ? [p] : []
  })
}

export function i18nKeys() {
  const keys = new Set()
  for (const f of files(join(app, 'src'))) {
    for (const m of readFileSync(f, 'utf8').matchAll(CALL)) keys.add(Function(`return ${m[1]}`)())
  }
  for (const name of readdirSync(join(app, 'plugins'))) {
    const manifest = JSON.parse(readFileSync(join(app, 'plugins', name, 'hob-plugin.json'), 'utf8'))
    for (const k of ['name', 'description']) if (manifest[k]) keys.add(manifest[k])
    for (const s of manifest.starters ?? []) if (s.title) keys.add(s.title)
  }
  for (const m of JSON.parse(readFileSync(join(app, '../catalog/catalog.json'), 'utf8')).models) if (m.description) keys.add(m.description)
  return [...keys].sort()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(i18nKeys(), null, 2))
