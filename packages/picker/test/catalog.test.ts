import { describe, expect, it } from 'vitest'
import { validateCatalog } from '../src/catalog-schema'
import real from '../../../catalog/catalog.json'
import licenses from '../../../catalog/licenses.json'
import { models } from './fixtures'

describe('validateCatalog', () => {
  it('accepts the shipped catalog', () => {
    const r = validateCatalog(real, licenses)
    expect(r.ok ? [] : r.errors).toEqual([])
  })
  it('rejects disallowed licenses', () => {
    const r = validateCatalog({ version: 1, models: [{ ...models[0], license: 'CC-BY-NC-4.0' }] }, licenses)
    expect(r.ok).toBe(false)
  })
  it('rejects duplicate ids', () => {
    const r = validateCatalog({ version: 1, models: [models[0], models[0]] }, licenses)
    expect(r.ok).toBe(false)
  })
  it('rejects missing sha256', () => {
    const bad = { ...models[0], builds: [{ ...models[0].builds[0], sha256: '' }] }
    expect(validateCatalog({ version: 1, models: [bad] }, licenses).ok).toBe(false)
  })
  it('requires at least one starter model', () => {
    expect(validateCatalog({ version: 1, models: [models[3]] }, licenses).ok).toBe(false)
  })
})
