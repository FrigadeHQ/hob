import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { copyIn, isInside, validFilesDir } from '../src/main/workspace'
import { RunningTurns } from '../src/main/agent/running'
import { moveAcross } from '../src/main/tools/files'

const tmp = () => mkdtempSync(join(tmpdir(), 'mabel-polish-'))

it('names that merely start with ".." are inside', () => {
  const r = tmp()
  expect(isInside(r, join(r, '..notes'))).toBe(true)
  expect(isInside(r, join(r, '..', 'x'))).toBe(false)
})

it('files location must be an absolute, specific folder', () => {
  expect(validFilesDir('relative/dir')).toBe(false)
  expect(validFilesDir('/')).toBe(false)
  expect(validFilesDir(homedir())).toBe(false)
  expect(validFilesDir(join(homedir(), 'Documents', 'Mabel'))).toBe(true)
})

it("a chat's own folder (or a folder containing it) can't be added to itself", () => {
  const root = tmp(); const chat = join(root, 'chat'); mkdirSync(chat)
  writeFileSync(join(chat, 'a.txt'), 'x')
  expect(() => copyIn(chat, [chat])).toThrow(/already in this chat/)
  expect(() => copyIn(chat, [root])).toThrow(/already in this chat/)
  expect(() => copyIn(chat, [join(chat, 'a.txt')])).toThrow(/already in this chat/)
})

it('Stop that arrives before the turn starts still stops it', () => {
  const t = new RunningTurns()
  t.stop('r1')
  expect(t.start('r1').signal.aborted).toBe(true)
  const c = t.start('r2')
  t.stop('r2')
  expect(c.signal.aborted).toBe(true)
  t.finish('r2')
  expect(t.start('r2').signal.aborted).toBe(false)
})

it('moves across drives fall back to copy + remove', () => {
  const root = tmp()
  writeFileSync(join(root, 'a.txt'), 'hello')
  const exdev = () => { throw Object.assign(new Error('cross-device'), { code: 'EXDEV' }) }
  moveAcross(join(root, 'a.txt'), join(root, 'b.txt'), exdev)
  expect(readFileSync(join(root, 'b.txt'), 'utf8')).toBe('hello')
  expect(() => readFileSync(join(root, 'a.txt'))).toThrow()
})

it('web access is on unless the user turned it off', async () => {
  const { webAccessOn } = await import('../src/main/settings')
  expect(webAccessOn({})).toBe(true)
  expect(webAccessOn({ webAccess: false })).toBe(false)
})
