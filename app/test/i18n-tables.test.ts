import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LOCALES, type Entry } from '../src/shared/i18n'
// @ts-expect-error plain JS script
import { i18nKeys } from '../scripts/i18n-keys.mjs'

const keys: string[] = i18nKeys()
const dir = join(__dirname, '../src/shared/locales')
const load = (id: string): Record<string, Entry> => JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8'))
const blanks = (s: string) => [...new Set(s.match(/\{\w+\}/g) ?? [])].sort()
const forms = (e: Entry) => (typeof e === 'string' ? [e] : Object.values(e))

describe('English', () => {
  const en = load('en')
  it('has both forms for every text with a count', () => {
    const counted = keys.filter((k) => k.includes('{count}'))
    expect(counted.filter((k) => typeof en[k] !== 'object' || !en[k].one || !en[k].other)).toEqual([])
  })
  it('keeps no forms for text the app no longer shows', () => {
    expect(Object.keys(en).filter((k) => !keys.includes(k))).toEqual([])
  })
})

describe.each(LOCALES.filter((l) => l.id !== 'en'))('$english', ({ id }) => {
  it('has a table', () => expect(existsSync(join(dir, `${id}.json`))).toBe(true))
  const table = existsSync(join(dir, `${id}.json`)) ? load(id) : {}
  it('translates everything the app shows', () => {
    expect(keys.filter((k) => !(k in table))).toEqual([])
  })
  it('keeps nothing the app no longer shows', () => {
    expect(Object.keys(table).filter((k) => !keys.includes(k))).toEqual([])
  })
  it('keeps every blank, and leaves none empty', () => {
    const wrong = Object.entries(table).filter(([k, v]) => {
      if (typeof v !== 'string' && !v.other) return true
      if (forms(v).some((f) => !f.trim())) return true
      const other = typeof v === 'string' ? v : v.other!
      // a singular form may say "one" instead of {count}
      return blanks(other).join() !== blanks(k).join() || forms(v).some((f) => blanks(f).some((b) => !blanks(k).includes(b)))
    }).map(([k]) => k)
    expect(wrong).toEqual([])
  })
})
