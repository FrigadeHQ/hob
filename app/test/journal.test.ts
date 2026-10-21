import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { Journal, undo, type UndoOp } from '../src/main/agent/journal'

it('undo reverses create, replace, move and delete in reverse order', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mabel-undo-'))
  const ops: UndoOp[] = []
  const j = new Journal({ backupDir: join(dir, '.backup'), save: (op) => ops.push(op) })
  writeFileSync(join(dir, 'keep.txt'), 'original')
  writeFileSync(join(dir, 'gone.txt'), 'delete me')
  mkdirSync(join(dir, 'sub'))
  writeFileSync(join(dir, 'move.txt'), 'moving')

  j.beforeReplace(join(dir, 'keep.txt')); writeFileSync(join(dir, 'keep.txt'), 'changed')
  writeFileSync(join(dir, 'new.txt'), 'new'); j.created(join(dir, 'new.txt'))
  renameSync(join(dir, 'move.txt'), join(dir, 'sub', 'move.txt')); j.moved(join(dir, 'move.txt'), join(dir, 'sub', 'move.txt'))
  j.beforeDelete(join(dir, 'gone.txt')); rmSync(join(dir, 'gone.txt'))
  expect(j.count).toBe(4)

  const trashed: string[] = []
  await undo(ops, async (p) => { trashed.push(p); rmSync(p) })
  expect(readFileSync(join(dir, 'keep.txt'), 'utf8')).toBe('original')
  expect(existsSync(join(dir, 'new.txt'))).toBe(false)
  expect(trashed).toEqual([join(dir, 'new.txt')])
  expect(readFileSync(join(dir, 'move.txt'), 'utf8')).toBe('moving')
  expect(readFileSync(join(dir, 'gone.txt'), 'utf8')).toBe('delete me')
})

it('undo keeps a created folder the user has since put files in', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mabel-undo-'))
  mkdirSync(join(dir, 'Docs')); writeFileSync(join(dir, 'Docs', 'mine.txt'), 'user file')
  const trashed: string[] = []
  await undo([{ type: 'created', path: join(dir, 'Docs') }], async (p) => { trashed.push(p) })
  expect(trashed).toEqual([])
})

it('undo keeps going past problems and reports how many changes it could not undo', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mabel-undo-'))
  writeFileSync(join(dir, 'a.txt'), 'mine now')          // user put a new file where a.txt was
  writeFileSync(join(dir, 'moved-a.txt'), 'original a')
  writeFileSync(join(dir, 'moved-b.txt'), 'original b')
  const ops: UndoOp[] = [
    { type: 'moved', from: join(dir, 'a.txt'), to: join(dir, 'moved-a.txt') },
    { type: 'moved', from: join(dir, 'gone.txt'), to: join(dir, 'missing.txt') }, // target since deleted
    { type: 'moved', from: join(dir, 'b.txt'), to: join(dir, 'moved-b.txt') },
  ]
  const r = await undo(ops, async () => {})
  expect(r.failed).toBe(1)
  expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('mine now')          // never overwritten
  expect(readFileSync(join(dir, 'a (2).txt'), 'utf8')).toBe('original a')
  expect(readFileSync(join(dir, 'b.txt'), 'utf8')).toBe('original b')        // earlier op still undone
})

it('big deletes are not copied; their undo reports them as not restorable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mabel-undo-'))
  writeFileSync(join(dir, 'big.bin'), Buffer.alloc(3000))
  const ops: UndoOp[] = []
  const j = new Journal({ backupDir: join(dir, '.backup'), save: (op) => ops.push(op), maxBackupBytes: 1000 })
  j.beforeDelete(join(dir, 'big.bin'))
  expect(ops[0]).toMatchObject({ type: 'deleted', backup: null })
  expect(existsSync(join(dir, '.backup'))).toBe(false)
  rmSync(join(dir, 'big.bin'))
  expect((await undo(ops, async () => {})).failed).toBe(1)
})

it('pruneUndo removes backups for given tasks and ones older than the cutoff', async () => {
  const { pruneUndo } = await import('../src/main/agent/journal')
  const { utimesSync } = await import('node:fs')
  const root = mkdtempSync(join(tmpdir(), 'mabel-undo-'))
  for (const t of ['old', 'keep', 'chatTask']) mkdirSync(join(root, t))
  const past = new Date(Date.now() - 40 * 86_400_000)
  utimesSync(join(root, 'old'), past, past)
  pruneUndo(root, { taskIds: ['chatTask'], olderThanDays: 30 })
  expect(existsSync(join(root, 'old'))).toBe(false)
  expect(existsSync(join(root, 'chatTask'))).toBe(false)
  expect(existsSync(join(root, 'keep'))).toBe(true)
})
