import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { validateCatalog } from '../packages/picker/src/catalog-schema'

const here = dirname(fileURLToPath(import.meta.url))
const raw = JSON.parse(readFileSync(join(here, 'catalog.json'), 'utf8'))
const licenses = JSON.parse(readFileSync(join(here, 'licenses.json'), 'utf8'))
const r = validateCatalog(raw, licenses)
if (!r.ok) {
  console.error(r.errors.join('\n'))
  process.exit(1)
}
console.log(`catalog ok: ${r.catalog.models.length} models`)
