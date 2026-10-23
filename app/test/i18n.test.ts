import { afterEach, describe, expect, it } from 'vitest'
import { dirOf, LOCALES, matchLocale, msg, setLanguage, t, translate } from '../src/shared/i18n'

afterEach(() => setLanguage('en'))

describe('matchLocale: the computer’s languages to one Hob speaks', () => {
  it('takes the first language Hob has', () => {
    expect(matchLocale(['xx-YY', 'de-AT', 'fr-FR'])).toBe('de')
  })
  it('falls back to English when it has none of them', () => {
    expect(matchLocale(['xx-YY'])).toBe('en')
    expect(matchLocale([])).toBe('en')
  })
  it('knows the regional ones apart', () => {
    expect(matchLocale(['pt-PT'])).toBe('pt-BR')
    expect(matchLocale(['zh-Hant-HK'])).toBe('zh-TW')
    expect(matchLocale(['zh-HK'])).toBe('zh-TW')
    expect(matchLocale(['zh-Hans-CN'])).toBe('zh-CN')
    expect(matchLocale(['zh'])).toBe('zh-CN')
  })
  it('understands other names for the same language', () => {
    expect(matchLocale(['no'])).toBe('nb')
    expect(matchLocale(['nn-NO'])).toBe('nb')
    expect(matchLocale(['tl-PH'])).toBe('fil')
    expect(matchLocale(['iw'])).toBe('he')
    expect(matchLocale(['in-ID'])).toBe('id')
    expect(matchLocale(['ES_es'])).toBe('es')
  })
})

describe('t', () => {
  it('is the English text in English, with the blanks filled', () => {
    expect(t('Deleted {name}', { name: 'notes.txt' })).toBe('Deleted notes.txt')
  })
  it('uses the translation, and English where one is missing', () => {
    const table = { de: { 'New chat': 'Neuer Chat' } }
    expect(translate(table, 'de', 'New chat')).toBe('Neuer Chat')
    expect(translate(table, 'de', 'Settings')).toBe('Settings')
  })
  it('picks the plural form for the count, in that language’s rules', () => {
    const table = {
      en: { '{count} files': { one: '{count} file', other: '{count} files' } },
      pl: { '{count} files': { one: '{count} plik', few: '{count} pliki', many: '{count} plików', other: '{count} pliku' } },
    }
    expect(translate(table, 'en', '{count} files', { count: 1 })).toBe('1 file')
    expect(translate(table, 'en', '{count} files', { count: 3 })).toBe('3 files')
    expect(translate(table, 'pl', '{count} files', { count: 3 })).toBe('3 pliki')
    expect(translate(table, 'pl', '{count} files', { count: 5 })).toBe('5 plików')
  })
  it('writes numbers the way the language does', () => {
    expect(translate({}, 'de', '{count} words', { count: 12500 })).toBe('12.500 words')
  })
  it('leaves a blank it has no value for', () => {
    expect(t('Hello {name}')).toBe('Hello {name}')
  })
})

describe('the language list', () => {
  it('has English first, then names each language in itself', () => {
    expect(LOCALES[0].id).toBe('en')
    expect(LOCALES.find((l) => l.id === 'de')?.name).toBe('Deutsch')
    expect(LOCALES.find((l) => l.id === 'ja')?.name).toBe('日本語')
  })
  it('reads Arabic and Hebrew right to left', () => {
    expect(dirOf('ar')).toBe('rtl')
    expect(dirOf('he')).toBe('rtl')
    expect(dirOf('de')).toBe('ltr')
  })
  it('msg marks text for translation and returns it as is', () => {
    expect(msg('General')).toBe('General')
  })
})
