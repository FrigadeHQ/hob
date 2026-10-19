import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { validateCatalog, type Catalog } from '@hob/picker'

export const CATALOG_URL = 'https://raw.githubusercontent.com/FrigadeHQ/opencowork/main/catalog/catalog.json'

export async function loadCatalog(opts: { url: string; cachePath: string; bundled: unknown; licenses: string[]; fetchFn?: typeof fetch }): Promise<Catalog> {
  const fetchFn = opts.fetchFn ?? fetch
  try {
    const res = await fetchFn(opts.url, { signal: AbortSignal.timeout(5000) })
    const r = validateCatalog(await res.json(), opts.licenses)
    if (r.ok) {
      writeFileSync(opts.cachePath, JSON.stringify(r.catalog))
      return r.catalog
    }
  } catch { /* offline or bad response: fall through */ }
  if (existsSync(opts.cachePath)) {
    try {
      const r = validateCatalog(JSON.parse(readFileSync(opts.cachePath, 'utf8')), opts.licenses)
      if (r.ok) return r.catalog
    } catch { /* corrupt cache */ }
  }
  const r = validateCatalog(opts.bundled, opts.licenses)
  if (!r.ok) throw new Error('Bundled catalog is invalid: ' + r.errors.join('; '))
  return r.catalog
}
