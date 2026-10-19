import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { migrateFilesDir, migrateProfile } from '../src/main/migrate'
import { Store } from '../src/main/store'

it('moves the old Thrum profile to Hob once, renaming the database', () => {
  const appData = mkdtempSync(join(tmpdir(), 'hob-mig-'))
  mkdirSync(join(appData, 'Thrum', 'models'), { recursive: true })
  writeFileSync(join(appData, 'Thrum', 'thrum.db'), 'db')
  writeFileSync(join(appData, 'Thrum', 'models', 'm.gguf'), 'model')
  migrateProfile(appData)
  expect(existsSync(join(appData, 'Thrum'))).toBe(false)
  expect(readFileSync(join(appData, 'Hob', 'hob.db'), 'utf8')).toBe('db')
  expect(readFileSync(join(appData, 'Hob', 'models', 'm.gguf'), 'utf8')).toBe('model')
  migrateProfile(appData) // second run: nothing to do
  expect(existsSync(join(appData, 'Hob', 'hob.db'))).toBe(true)
})

it('never overwrites an existing Hob profile', () => {
  const appData = mkdtempSync(join(tmpdir(), 'hob-mig-'))
  mkdirSync(join(appData, 'Thrum')); mkdirSync(join(appData, 'Hob'))
  writeFileSync(join(appData, 'Hob', 'hob.db'), 'new')
  migrateProfile(appData)
  expect(readFileSync(join(appData, 'Hob', 'hob.db'), 'utf8')).toBe('new')
  expect(existsSync(join(appData, 'Thrum'))).toBe(true)
})

it('moves ~/Documents/Thrum to Hob and points saved chats and their files at the new place', () => {
  const docs = mkdtempSync(join(tmpdir(), 'hob-docs-'))
  const oldChat = join(docs, 'Thrum', '2026-10-15 13.30')
  mkdirSync(oldChat, { recursive: true }); writeFileSync(join(oldChat, 'chart.png'), 'png')
  const store = new Store(':memory:')
  store.createChat('c', oldChat)
  store.addMessage('c', { role: 'user', content: 'hi', attachments: [{ name: 'chart.png', path: join(oldChat, 'chart.png'), sizeBytes: 3 }] })
  store.addMessage('c', { role: 'assistant', content: 'done', steps: [{ id: 's', title: 'Ran code', status: 'done', files: [join(oldChat, 'chart.png')] }] })
  migrateFilesDir(join(docs, 'Thrum'), join(docs, 'Hob'), store)
  const newChat = join(docs, 'Hob', '2026-10-15 13.30')
  expect(readFileSync(join(newChat, 'chart.png'), 'utf8')).toBe('png')
  expect(store.getChat('c')?.dir).toBe(newChat)
  const [u, a] = store.messages('c')
  expect(u.attachments[0].path).toBe(join(newChat, 'chart.png'))
  expect(a.steps[0].files).toEqual([join(newChat, 'chart.png')])
})
