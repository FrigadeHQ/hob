import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadCatalog } from '../src/main/catalog'
import bundled from '../../catalog/catalog.json'
import licenses from '../../catalog/licenses.json'

const cachePath = () => join(mkdtempSync(join(tmpdir(), 'hob-cat-')), 'catalog.json')
// a smaller valid catalog: the starter plus one more
const remote = { ...bundled, models: [bundled.models.find((m) => m.starter)!, bundled.models.find((m) => !m.starter)!] }
const ok = (body: unknown) => (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch
const fail = (async () => { throw new Error('offline') }) as unknown as typeof fetch

describe('loadCatalog', () => {
  it('uses remote when valid and caches it', async () => {
    const c = cachePath()
    const cat = await loadCatalog({ url: 'x', cachePath: c, bundled, licenses, fetchFn: ok(remote) })
    expect(cat.models).toHaveLength(2)
    expect(JSON.parse(readFileSync(c, 'utf8')).models).toHaveLength(2)
  })
  it('falls back to cache when offline', async () => {
    const c = cachePath(); writeFileSync(c, JSON.stringify(remote))
    expect((await loadCatalog({ url: 'x', cachePath: c, bundled, licenses, fetchFn: fail })).models).toHaveLength(2)
  })
  it('falls back to bundled when offline and no cache', async () => {
    expect((await loadCatalog({ url: 'x', cachePath: cachePath(), bundled, licenses, fetchFn: fail })).models).toHaveLength(bundled.models.length)
  })
  it('ignores an invalid remote catalog', async () => {
    const cat = await loadCatalog({ url: 'x', cachePath: cachePath(), bundled, licenses, fetchFn: ok({ version: 1, models: [] }) })
    expect(cat.models).toHaveLength(bundled.models.length)
  })
})
