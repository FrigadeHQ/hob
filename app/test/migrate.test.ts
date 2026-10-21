import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { migrateFilesDir, migrateProfile } from '../src/main/migrate'
import { Store } from '../src/main/store'

it('moves the old Thrum profile to Garth once, renaming the database', () => {
  const appData = mkdtempSync(join(tmpdir(), 'garth-mig-'))
  mkdirSync(join(appData, 'Thrum', 'models'), { recursive: true })
  writeFileSync(join(appData, 'Thrum', 'thrum.db'), 'db')
  writeFileSync(join(appData, 'Thrum', 'models', 'm.gguf'), 'model')
  migrateProfile(appData)
  expect(existsSync(join(appData, 'Thrum'))).toBe(false)
  expect(readFileSync(join(appData, 'Garth', 'garth.db'), 'utf8')).toBe('db')
  expect(readFileSync(join(appData, 'Garth', 'models', 'm.gguf'), 'utf8')).toBe('model')
  migrateProfile(appData) // second run: nothing to do
  expect(existsSync(join(appData, 'Garth', 'garth.db'))).toBe(true)
})

it('never overwrites an existing Garth profile', () => {
  const appData = mkdtempSync(join(tmpdir(), 'garth-mig-'))
  mkdirSync(join(appData, 'Thrum')); mkdirSync(join(appData, 'Garth'))
  writeFileSync(join(appData, 'Garth', 'garth.db'), 'new')
  migrateProfile(appData)
  expect(readFileSync(join(appData, 'Garth', 'garth.db'), 'utf8')).toBe('new')
  expect(existsSync(join(appData, 'Thrum'))).toBe(true)
})

it('moves ~/Documents/Thrum to Garth and points saved chats and their files at the new place', () => {
  const docs = mkdtempSync(join(tmpdir(), 'garth-docs-'))
  const oldChat = join(docs, 'Thrum', '2026-10-15 13.30')
  mkdirSync(oldChat, { recursive: true }); writeFileSync(join(oldChat, 'chart.png'), 'png')
  const store = new Store(':memory:')
  store.createChat('c', oldChat)
  store.addMessage('c', { role: 'user', content: 'hi', attachments: [{ name: 'chart.png', path: join(oldChat, 'chart.png'), sizeBytes: 3 }] })
  store.addMessage('c', { role: 'assistant', content: 'done', steps: [{ id: 's', title: 'Ran code', status: 'done', files: [join(oldChat, 'chart.png')] }] })
  migrateFilesDir(join(docs, 'Thrum'), join(docs, 'Garth'), store)
  const newChat = join(docs, 'Garth', '2026-10-15 13.30')
  expect(readFileSync(join(newChat, 'chart.png'), 'utf8')).toBe('png')
  expect(store.getChat('c')?.dir).toBe(newChat)
  const [u, a] = store.messages('c')
  expect(u.attachments[0].path).toBe(join(newChat, 'chart.png'))
  expect(a.steps[0].files).toEqual([join(newChat, 'chart.png')])
})

it('moves the Hob profile over once, models and all', () => {
  const appData = mkdtempSync(join(tmpdir(), 'garth-mig-'))
  mkdirSync(join(appData, 'Hob', 'models'), { recursive: true })
  writeFileSync(join(appData, 'Hob', 'hob.db'), 'db')
  writeFileSync(join(appData, 'Hob', 'hob.db-wal'), 'wal')
  writeFileSync(join(appData, 'Hob', 'models', 'big.gguf'), 'model')
  migrateProfile(appData)
  expect(existsSync(join(appData, 'Hob'))).toBe(false)
  expect(readFileSync(join(appData, 'Garth', 'garth.db'), 'utf8')).toBe('db')
  expect(readFileSync(join(appData, 'Garth', 'garth.db-wal'), 'utf8')).toBe('wal')
  expect(readFileSync(join(appData, 'Garth', 'models', 'big.gguf'), 'utf8')).toBe('model')
})

it('moves a Mabel profile (the newest old name) to Garth, before any older one', () => {
  const appData = mkdtempSync(join(tmpdir(), 'garth-appdata-'))
  mkdirSync(join(appData, 'Mabel')); writeFileSync(join(appData, 'Mabel', 'mabel.db'), 'new')
  mkdirSync(join(appData, 'Hob')); writeFileSync(join(appData, 'Hob', 'hob.db'), 'old')
  migrateProfile(appData)
  expect(readFileSync(join(appData, 'Garth', 'garth.db'), 'utf8')).toBe('new')
  expect(existsSync(join(appData, 'Hob'))).toBe(true)
})
