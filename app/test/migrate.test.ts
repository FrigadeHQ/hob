import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { migrateFilesDir, migrateProfile } from '../src/main/migrate'
import { Store } from '../src/main/store'

it('moves the old Thrum profile to Mabel once, renaming the database', () => {
  const appData = mkdtempSync(join(tmpdir(), 'mabel-mig-'))
  mkdirSync(join(appData, 'Thrum', 'models'), { recursive: true })
  writeFileSync(join(appData, 'Thrum', 'thrum.db'), 'db')
  writeFileSync(join(appData, 'Thrum', 'models', 'm.gguf'), 'model')
  migrateProfile(appData)
  expect(existsSync(join(appData, 'Thrum'))).toBe(false)
  expect(readFileSync(join(appData, 'Mabel', 'mabel.db'), 'utf8')).toBe('db')
  expect(readFileSync(join(appData, 'Mabel', 'models', 'm.gguf'), 'utf8')).toBe('model')
  migrateProfile(appData) // second run: nothing to do
  expect(existsSync(join(appData, 'Mabel', 'mabel.db'))).toBe(true)
})

it('never overwrites an existing Mabel profile', () => {
  const appData = mkdtempSync(join(tmpdir(), 'mabel-mig-'))
  mkdirSync(join(appData, 'Thrum')); mkdirSync(join(appData, 'Mabel'))
  writeFileSync(join(appData, 'Mabel', 'mabel.db'), 'new')
  migrateProfile(appData)
  expect(readFileSync(join(appData, 'Mabel', 'mabel.db'), 'utf8')).toBe('new')
  expect(existsSync(join(appData, 'Thrum'))).toBe(true)
})

it('moves ~/Documents/Thrum to Mabel and points saved chats and their files at the new place', () => {
  const docs = mkdtempSync(join(tmpdir(), 'mabel-docs-'))
  const oldChat = join(docs, 'Thrum', '2026-10-15 13.30')
  mkdirSync(oldChat, { recursive: true }); writeFileSync(join(oldChat, 'chart.png'), 'png')
  const store = new Store(':memory:')
  store.createChat('c', oldChat)
  store.addMessage('c', { role: 'user', content: 'hi', attachments: [{ name: 'chart.png', path: join(oldChat, 'chart.png'), sizeBytes: 3 }] })
  store.addMessage('c', { role: 'assistant', content: 'done', steps: [{ id: 's', title: 'Ran code', status: 'done', files: [join(oldChat, 'chart.png')] }] })
  migrateFilesDir(join(docs, 'Thrum'), join(docs, 'Mabel'), store)
  const newChat = join(docs, 'Mabel', '2026-10-15 13.30')
  expect(readFileSync(join(newChat, 'chart.png'), 'utf8')).toBe('png')
  expect(store.getChat('c')?.dir).toBe(newChat)
  const [u, a] = store.messages('c')
  expect(u.attachments[0].path).toBe(join(newChat, 'chart.png'))
  expect(a.steps[0].files).toEqual([join(newChat, 'chart.png')])
})

it('moves the Hob profile (the name before Mabel) over once, models and all', () => {
  const appData = mkdtempSync(join(tmpdir(), 'mabel-mig-'))
  mkdirSync(join(appData, 'Hob', 'models'), { recursive: true })
  writeFileSync(join(appData, 'Hob', 'hob.db'), 'db')
  writeFileSync(join(appData, 'Hob', 'hob.db-wal'), 'wal')
  writeFileSync(join(appData, 'Hob', 'models', 'big.gguf'), 'model')
  migrateProfile(appData)
  expect(existsSync(join(appData, 'Hob'))).toBe(false)
  expect(readFileSync(join(appData, 'Mabel', 'mabel.db'), 'utf8')).toBe('db')
  expect(readFileSync(join(appData, 'Mabel', 'mabel.db-wal'), 'utf8')).toBe('wal')
  expect(readFileSync(join(appData, 'Mabel', 'models', 'big.gguf'), 'utf8')).toBe('model')
})
