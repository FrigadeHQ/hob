import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { Store } from '../src/main/store'

it('stores chats and messages with attachments and steps', () => {
  const s = new Store(':memory:')
  s.createChat('c1', '/w/c1', 1000)
  s.createChat('c2', '/w/c2', 2000)
  expect(s.listChats().map((c) => c.id)).toEqual(['c2', 'c1'])
  const id = s.addMessage('c1', { role: 'user', content: 'hi', attachments: [{ name: 'a.csv', path: '/w/c1/a.csv', sizeBytes: 3 }] })
  s.addMessage('c1', { role: 'assistant', content: 'yo', steps: [{ id: 's', title: 'Read a.csv', status: 'done' }], taskId: 't1', undoable: true })
  expect(s.listChats()[0].id).toBe('c1') // touched by the new message
  const ms = s.messages('c1')
  expect(ms[0]).toMatchObject({ id, role: 'user', attachments: [{ name: 'a.csv' }], steps: [], undoable: false })
  expect(ms[1]).toMatchObject({ role: 'assistant', steps: [{ title: 'Read a.csv' }], taskId: 't1', undoable: true, undone: false })
  s.updateMessage(ms[1].id, { undone: true })
  expect(s.getMessage(ms[1].id)).toMatchObject({ chatId: 'c1', undone: true })
  s.renameChat('c1', 'Sales summary')
  expect(s.getChat('c1')?.title).toBe('Sales summary')
  s.deleteChat('c1')
  expect(s.getChat('c1')).toBeUndefined()
  expect(s.messages('c1')).toEqual([])
})

it('stores chat grants, always-allow folders and undo ops in order', () => {
  const s = new Store(':memory:')
  s.createChat('c1', '/w/c1')
  s.addChatGrant('c1', '/Users/me/Downloads'); s.addChatGrant('c1', '/Users/me/Downloads')
  expect(s.chatGrants('c1')).toEqual(['/Users/me/Downloads'])
  s.addAlways('c1', '/x')
  expect(s.alwaysFolders('c1')).toEqual(['/x'])
  s.addUndoOp('t', { type: 'created', path: '/a' })
  s.addUndoOp('t', { type: 'created', path: '/b' })
  expect(s.undoOps('t')).toEqual([{ type: 'created', path: '/a' }, { type: 'created', path: '/b' }])
  // a chat's folders go with it
  s.deleteChat('c1')
  expect(s.chatGrants('c1')).toEqual([])
})

it('projects: a name, folders in order (the first is the main one), instructions; chats sit in them', () => {
  const s = new Store(':memory:')
  const p = s.createProject('p1', { name: 'Japan trip', instructions: 'Name photos by date', folders: ['/Users/me/Photos', '/Users/me/Notes', '/Users/me/Photos'] }, 1000)
  expect(p).toEqual({ id: 'p1', name: 'Japan trip', instructions: 'Name photos by date', folders: ['/Users/me/Photos', '/Users/me/Notes'] })
  s.createProject('p2', { name: 'Taxes', instructions: '', folders: [] }, 2000)
  expect(s.listProjects().map((x) => x.name)).toEqual(['Japan trip', 'Taxes'])

  s.updateProject('p1', { name: 'Japan', instructions: '', folders: ['/Users/me/Notes', '/Users/me/Trip'] })
  expect(s.getProject('p1')).toMatchObject({ name: 'Japan', instructions: '', folders: ['/Users/me/Notes', '/Users/me/Trip'] })

  expect(s.createChat('c1', '/w/c1', 1, 'p1').projectId).toBe('p1')
  expect(s.createChat('c2', '/w/c2').projectId).toBeNull()
  s.addChatGrant('c2', '/Users/me/Desktop/x')
  expect(s.knownFolders().sort()).toEqual(['/Users/me/Desktop/x', '/Users/me/Notes', '/Users/me/Trip'])

  // removing a project keeps its chats, now outside any project
  s.removeProject('p1')
  expect(s.getProject('p1')).toBeUndefined()
  expect(s.getChat('c1')?.projectId).toBeNull()
  expect(s.knownFolders()).toEqual(['/Users/me/Desktop/x'])
})

it('persists to disk', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'hob-db-')), 'hob.db')
  const a = new Store(path); a.createChat('c', '/w', 1); a.close()
  expect(new Store(path).getChat('c')?.dir).toBe('/w')
})

it('keeps how long the agent worked on a reply, and upgrades older databases', async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const path = join(mkdtempSync(join(tmpdir(), 'hob-db-')), 'old.db')
  const old = new DatabaseSync(path)
  old.exec(`CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, attachments TEXT NOT NULL DEFAULT '[]', steps TEXT NOT NULL DEFAULT '[]', task_id TEXT, undoable INTEGER NOT NULL DEFAULT 0, undone INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`)
  old.close()
  const s = new Store(path)
  s.createChat('c', '/w')
  s.addMessage('c', { role: 'assistant', content: 'done', workedMs: 12_345 })
  expect(s.messages('c')[0].workedMs).toBe(12_345)
})

it('searches chats by title and by what was said, with a snippet around the match', () => {
  const s = new Store(':memory:')
  s.createChat('c1', '/w/c1', 1000); s.renameChat('c1', 'Shipping wine to Canada')
  s.createChat('c2', '/w/c2', 2000); s.renameChat('c2', 'Weekend plans')
  s.addMessage('c2', { role: 'assistant', content: `${'x '.repeat(80)}You could ship the WINE with a freight forwarder instead. ${'y '.repeat(80)}` }, 3000)
  s.createChat('c3', '/w/c3', 4000); s.renameChat('c3', '100% done_')
  const r = s.searchChats('wine')
  // title matches first, then matches in messages
  expect(r.map((c) => c.id)).toEqual(['c1', 'c2'])
  expect(r[0].snippet).toBeUndefined()
  expect(r[1].snippet).toMatch(/^….*ship the WINE with a freight.*…$/)
  expect(r[1].snippet!.length).toBeLessThan(140)
  // % and _ are plain characters, not wildcards
  expect(s.searchChats('0%').map((c) => c.id)).toEqual(['c3'])
  expect(s.searchChats('e_').map((c) => c.id)).toEqual(['c3'])
  expect(s.searchChats('  ')).toEqual([])
})

it('a chat can be cut back to its first messages (to edit a message or try a reply again)', () => {
  const s = new Store(':memory:')
  s.createChat('c', '/c'); s.createChat('other', '/o')
  for (const [role, content] of [['user', 'one'], ['assistant', 'reply one'], ['user', 'two'], ['assistant', 'reply two']] as const) s.addMessage('c', { role, content })
  s.addMessage('other', { role: 'user', content: 'untouched' })
  s.keepMessages('c', 2)
  expect(s.messages('c').map((m) => m.content)).toEqual(['one', 'reply one'])
  expect(s.messages('other')).toHaveLength(1)
  s.keepMessages('c', 0)
  expect(s.messages('c')).toEqual([])
})
