import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { expect, it } from 'vitest'
import { Journal, type UndoOp } from '../src/main/agent/journal'
import type { TurnCtx } from '../src/main/agent/tool'
import { deleteFile, listFiles, moveFile, moveFiles, openFolder, readFile, writeFile } from '../src/main/tools/files'
import { resolvePath } from '../src/main/agent/tool'

function ctx(): TurnCtx & { ops: UndoOp[]; trashed: string[] } {
  const root = mkdtempSync(join(tmpdir(), 'hob-tools-'))
  const chatDir = join(root, 'chat'); const grant = join(root, 'Downloads')
  mkdirSync(chatDir); mkdirSync(grant)
  const ops: UndoOp[] = []; const trashed: string[] = []
  return {
    chatDir, grants: [grant], signal: new AbortController().signal, untrusted: false, webAccess: false,
    journal: new Journal({ backupDir: join(root, 'undo'), save: (op) => ops.push(op) }),
    trash: async (p) => { trashed.push(p); rmSync(p, { recursive: true }) },
    python: undefined, runTmp: join(root, 'tmp'), fetch: globalThis.fetch,
    ops, trashed,
  }
}

it('read_file previews a CSV with its row count and path', async () => {
  const c = ctx()
  writeFileSync(join(c.chatDir, 'sales.csv'), 'name,sales\n' + Array.from({ length: 100 }, (_, i) => `r${i},${i}`).join('\n'))
  const out = await readFile.run({ path: 'sales.csv' }, c)
  expect(out.text).toContain(join(c.chatDir, 'sales.csv'))
  expect(out.text).toContain('101 lines')
  expect(out.text).toContain('name,sales')
  expect(readFile.title({ path: 'sales.csv' })).toBe('Read sales.csv')
  expect(readFile.action({ path: 'sales.csv' }, c)).toEqual({ kind: 'read', paths: [join(c.chatDir, 'sales.csv')] })
})

it('list_files lists the chat folder by default', async () => {
  const c = ctx()
  writeFileSync(join(c.chatDir, 'a.txt'), 'hi'); mkdirSync(join(c.chatDir, 'sub'))
  const out = await listFiles.run({}, c)
  expect(out.text).toContain('a.txt (2 B)')
  expect(out.text).toContain('sub/')
})

it('write_file creates files in the chat folder and reports them', async () => {
  const c = ctx()
  const out = await writeFile.run({ path: 'notes/summary.md', content: '# Hi' }, c)
  expect(readFileSync(join(c.chatDir, 'notes/summary.md'), 'utf8')).toBe('# Hi')
  expect(out.files).toEqual([join(c.chatDir, 'notes/summary.md')])
  expect(c.ops).toEqual([]) // chat folder isn't journaled
})

it('granted folder changes are journaled; delete goes to Trash', async () => {
  const c = ctx(); const g = c.grants[0]
  writeFileSync(join(g, 'a.txt'), 'old')
  await writeFile.run({ path: join(g, 'a.txt'), content: 'new' }, c)
  await moveFile.run({ from: join(g, 'a.txt'), to: join(g, 'sorted', 'a.txt') }, c)
  await deleteFile.run({ path: join(g, 'sorted', 'a.txt') }, c)
  expect(c.ops.map((o) => o.type)).toEqual(['replaced', 'created', 'moved', 'deleted']) // 'created' = the new sorted/ folder
  expect(c.trashed).toEqual([join(g, 'sorted', 'a.txt')])
  expect(existsSync(join(g, 'sorted', 'a.txt'))).toBe(false)
  expect(writeFile.action({ path: join(g, 'b.txt'), content: '' }, c)).toEqual({ kind: 'create', paths: [join(g, 'b.txt')] })
  expect(deleteFile.ask!({ path: join(g, 'x.pdf') })).toBe('Move x.pdf to the Trash?')
})

it('undo also removes folders the agent created in a granted folder (only if empty)', async () => {
  const c = ctx(); const g = c.grants[0]
  writeFileSync(join(g, 'a.txt'), 'x')
  await moveFile.run({ from: join(g, 'a.txt'), to: join(g, 'Docs', 'a.txt') }, c)
  expect(c.ops.map((o) => o.type)).toEqual(['created', 'moved'])
  const { undo } = await import('../src/main/agent/journal')
  await undo(c.ops, c.trash)
  expect(existsSync(join(g, 'a.txt'))).toBe(true)
  expect(existsSync(join(g, 'Docs'))).toBe(false)
})

it('never writes through a symlink, even one that points inside', async () => {
  const c = ctx()
  const { symlinkSync } = await import('node:fs')
  symlinkSync(join(c.chatDir, 'real.txt'), join(c.chatDir, 'link.txt'))
  await expect(writeFile.run({ path: 'link.txt', content: 'x' }, c)).rejects.toThrow(/link/i)
  expect(existsSync(join(c.chatDir, 'real.txt'))).toBe(false)
})

it('moving a file that is already there says so; moving onto a different file fails', async () => {
  const c = ctx(); const g = c.grants[0]
  mkdirSync(join(g, 'Images'))
  writeFileSync(join(g, 'Images', 'p.jpg'), 'img')
  const again = await moveFile.run({ from: join(g, 'p.jpg'), to: join(g, 'Images', 'p.jpg') }, c)
  expect(again.text).toMatch(/already in Images/i)
  expect(again.title).toBe('p.jpg is already in Images')
  expect(again.failed).toBeFalsy()

  writeFileSync(join(g, 'q.jpg'), 'new'); writeFileSync(join(g, 'Images', 'q.jpg'), 'old')
  const clash = await moveFile.run({ from: join(g, 'q.jpg'), to: join(g, 'Images', 'q.jpg') }, c)
  expect(clash.failed).toBe(true)
  expect(readFileSync(join(g, 'Images', 'q.jpg'), 'utf8')).toBe('old')
})

it("won't delete the chat folder or a granted folder itself", async () => {
  const c = ctx()
  await expect(deleteFile.run({ path: '.' }, c)).rejects.toThrow(/whole folder/)
  await expect(deleteFile.run({ path: c.grants[0] }, c)).rejects.toThrow(/whole folder/)
  expect(c.trashed).toEqual([])
})

it('approval text names the real folder', () => {
  const c = ctx(); const g = c.grants[0]
  expect(writeFile.ask!({ path: join(g, 'x.txt'), content: '' })).toBe(`Save x.txt in ${basename(g)}?`)
})

it('paths starting with ~ or $HOME mean the home folder, not a folder called "~" in the chat', () => {
  const c = { chatDir: '/chat' }
  expect(resolvePath(c, '~/Desktop/hob-test', '/Users/eric')).toBe(join('/Users/eric', 'Desktop', 'hob-test'))
  expect(resolvePath(c, '~', '/Users/eric')).toBe(join('/Users/eric'))
  expect(resolvePath(c, '$HOME/Desktop', '/Users/eric')).toBe(join('/Users/eric', 'Desktop'))
  expect(resolvePath(c, '~notes.txt', '/Users/eric')).toBe(join('/chat', '~notes.txt'))
  expect(resolvePath(c, 'a.txt', '/Users/eric')).toBe(join('/chat', 'a.txt'))
})

it('move_files renames many files in one go, each undoable', async () => {
  const c = ctx(); const g = c.grants[0]
  for (const n of ['IMG_1.jpg', 'IMG_2.jpg']) writeFileSync(join(g, n), n)
  const moves = [{ from: join(g, 'IMG_1.jpg'), to: join(g, '2024-01-01_001.jpg') }, { from: join(g, 'IMG_2.jpg'), to: join(g, '2024-02-03_001.jpg') }]
  expect(moveFiles.ask!({ moves })).toBe('Rename 2 files in Downloads?')
  expect(moveFiles.askDetail!({ moves })).toBe('IMG_1.jpg → 2024-01-01_001.jpg\nIMG_2.jpg → 2024-02-03_001.jpg')
  expect(moveFiles.title({ moves })).toBe('Renamed 2 files in Downloads')
  expect(moveFiles.action({ moves }, c)).toEqual({ kind: 'change', paths: moves.flatMap((m) => [m.from, m.to]) })
  const out = await moveFiles.run({ moves }, c)
  expect(out.failed).toBeFalsy()
  expect(readFileSync(join(g, '2024-02-03_001.jpg'), 'utf8')).toBe('IMG_2.jpg')
  expect(existsSync(join(g, 'IMG_1.jpg'))).toBe(false)
  expect(c.ops.filter((o) => o.type === 'moved')).toHaveLength(2)
  // asked again: says it's already done instead of failing
  expect((await moveFiles.run({ moves }, c)).text).toContain('already done')
})

it('move_files checks every rename first: one clash means nothing moves', async () => {
  const c = ctx(); const g = c.grants[0]
  for (const n of ['a.jpg', 'b.jpg', 'taken.jpg']) writeFileSync(join(g, n), n)
  const clash = await moveFiles.run({ moves: [{ from: join(g, 'a.jpg'), to: join(g, 'new.jpg') }, { from: join(g, 'b.jpg'), to: join(g, 'taken.jpg') }] }, c)
  expect(clash.failed).toBe(true)
  expect(clash.text).toContain('Nothing was moved')
  expect(existsSync(join(g, 'a.jpg'))).toBe(true)
  const twice = await moveFiles.run({ moves: [{ from: join(g, 'a.jpg'), to: join(g, 'same.jpg') }, { from: join(g, 'b.jpg'), to: join(g, 'same.jpg') }] }, c)
  expect(twice.text).toContain('both be called same.jpg')
  expect(existsSync(join(g, 'a.jpg'))).toBe(true)
  // a list sent as a JSON string still works
  const str = await moveFiles.run({ moves: JSON.stringify([{ from: join(g, 'a.jpg'), to: join(g, 'c.jpg') }]) as never }, c)
  expect(str.failed).toBeFalsy()
  expect(existsSync(join(g, 'c.jpg'))).toBe(true)
  expect((await moveFiles.run({ moves: [] }, c)).failed).toBe(true)
})

it('moving new files out of the chat folder only adds files; anything else is a change', () => {
  const c = ctx(); const g = c.grants[0]
  writeFileSync(join(c.chatDir, 'out.png'), 'x'); writeFileSync(join(g, 'taken.png'), 'y')
  expect(moveFile.action({ from: 'out.png', to: join(g, 'out.png') }, c).kind).toBe('create')
  expect(moveFiles.action({ moves: [{ from: 'out.png', to: join(g, 'out.png') }] }, c).kind).toBe('create')
  // the target is already there
  expect(moveFiles.action({ moves: [{ from: 'out.png', to: join(g, 'taken.png') }] }, c).kind).toBe('change')
  // moving the user's own files
  expect(moveFile.action({ from: join(g, 'taken.png'), to: join(g, 'b.png') }, c).kind).toBe('change')
})

it('open_folder opens a folder, shows a file in its folder, and defaults to the main folder', async () => {
  const shown: [string, boolean][] = []
  const c = { ...ctx(), reveal: async (p: string, folder: boolean) => { shown.push([p, folder]) } }
  const g = c.grants[0]
  writeFileSync(join(g, 'a.txt'), 'x')
  expect(openFolder.action({ path: g }, c)).toEqual({ kind: 'read', paths: [g] })
  expect((await openFolder.run({ path: g }, c)).text).toMatch(/^Opened .* in (Finder|File Explorer|your file manager)\.$/)
  await openFolder.run({ path: join(g, 'a.txt') }, c)
  // nothing is launched: a file is only shown
  expect(shown).toEqual([[g, true], [join(g, 'a.txt'), false]])
  // no path: the project's main folder, else the chat folder
  expect(openFolder.action({}, c)).toEqual({ kind: 'read', paths: [c.chatDir] })
  expect(openFolder.action({}, { ...c, mainFolder: g })).toEqual({ kind: 'read', paths: [g] })
  const gone = await openFolder.run({ path: join(g, 'nope') }, c)
  expect(gone.failed).toBe(true)
  expect(shown).toHaveLength(2)
})

it.runIf(process.platform === 'darwin')('open_folder never launches an app: bundles are only shown in their folder', async () => {
  const shown: [string, boolean][] = []
  const c = { ...ctx(), reveal: async (p: string, folder: boolean) => { shown.push([p, folder]) } }
  mkdirSync(join(c.chatDir, 'x.app', 'Contents'), { recursive: true })
  mkdirSync(join(c.chatDir, 'Sneaky', 'Contents'), { recursive: true })
  writeFileSync(join(c.chatDir, 'Sneaky', 'Contents', 'Info.plist'), '<plist/>')
  await openFolder.run({ path: 'x.app' }, c)
  await openFolder.run({ path: 'Sneaky' }, c)
  expect(shown).toEqual([[join(c.chatDir, 'x.app'), false], [join(c.chatDir, 'Sneaky'), false]])
})

it("open_folder: a project's main folder that's gone says so", async () => {
  const c = { ...ctx(), reveal: async () => {} }
  const gone = join(c.chatDir, '..', 'Gone')
  const r = await openFolder.run({}, { ...c, mainFolder: gone, missingFolders: [gone] })
  expect(r).toMatchObject({ failed: true })
  expect(r.text).toContain("Can't find")
  // nothing outside is touched to find that out
  expect(openFolder.action({}, { ...c, mainFolder: gone, missingFolders: [gone] })).toEqual({ kind: 'read', paths: [c.chatDir] })
})

it('only plain files moved out of the chat folder count as new: not programs, not the chat folder itself', async () => {
  const { chmodSync } = await import('node:fs')
  const c = ctx(); const g = c.grants[0]
  writeFileSync(join(c.chatDir, 'hook'), '#!/bin/sh'); chmodSync(join(c.chatDir, 'hook'), 0o755)
  mkdirSync(join(c.chatDir, 'Folder'))
  if (process.platform !== 'win32') expect(moveFile.action({ from: 'hook', to: join(g, 'hook') }, c).kind).toBe('change')
  expect(moveFile.action({ from: 'Folder', to: join(g, 'Folder') }, c).kind).toBe('change')
  expect(moveFile.action({ from: c.chatDir, to: join(g, 'x') }, c).kind).toBe('change')
})

it('move_files can take one folder and plain names (long paths are easy to mistype)', async () => {
  const c = ctx(); const g = c.grants[0]
  writeFileSync(join(g, 'IMG_1.jpg'), '1')
  const args = { folder: g, moves: [{ from: 'IMG_1.jpg', to: '2023-01-05_001.jpg' }] }
  expect(moveFiles.action(args, c)).toEqual({ kind: 'change', paths: [join(g, 'IMG_1.jpg'), join(g, '2023-01-05_001.jpg')] })
  expect(moveFiles.ask!(args)).toBe('Rename 1 file in Downloads?')
  await moveFiles.run(args, c)
  expect(existsSync(join(g, '2023-01-05_001.jpg'))).toBe(true)
})

it('move_files can read the list from a file code wrote, so the model never retypes long paths', async () => {
  const c = ctx(); const g = c.grants[0]
  writeFileSync(join(g, 'IMG_1.jpg'), '1'); writeFileSync(join(g, 'IMG_2.jpg'), '2')
  writeFileSync(join(c.chatDir, 'moves.json'), JSON.stringify([{ from: join(g, 'IMG_1.jpg'), to: join(g, 'a.jpg') }, { from: join(g, 'IMG_2.jpg'), to: join(g, 'b.jpg') }]))
  const args = moveFiles.prepare!({ file: 'moves.json' } as never, c)
  expect(moveFiles.ask!(args)).toBe('Rename 2 files in Downloads?')
  expect(moveFiles.askDetail!(args)).toBe('IMG_1.jpg → a.jpg\nIMG_2.jpg → b.jpg')
  // the list is only a means: no file card for it
  expect((await moveFiles.run(args, c)).uses).toEqual([join(c.chatDir, 'moves.json')])
  expect(existsSync(join(g, 'b.jpg'))).toBe(true)
  // {folder, moves} works too; a bad file says what's wrong
  writeFileSync(join(c.chatDir, 'm2.json'), JSON.stringify({ folder: g, moves: [{ from: 'a.jpg', to: 'c.jpg' }] }))
  expect(moveFiles.prepare!({ file: 'm2.json' } as never, c).moves).toEqual([{ from: join(g, 'a.jpg'), to: join(g, 'c.jpg') }])
  const bad = moveFiles.prepare!({ file: 'nope.json' } as never, c)
  expect((await moveFiles.run(bad, c)).text).toMatch(/Couldn't read nope\.json/)
})

it('move_files finds the list file however the model names it', () => {
  const c = ctx(); const g = c.grants[0]
  writeFileSync(join(c.chatDir, 'moves.json'), JSON.stringify([{ from: join(g, 'a'), to: join(g, 'b') }]))
  for (const args of [{ moves: 'moves.json' }, { path: 'moves.json' }, { file_path: 'moves.json' }, { filename: 'moves.json' }]) {
    expect(moveFiles.prepare!(args as never, c).moves).toEqual([{ from: join(g, 'a'), to: join(g, 'b') }])
  }
})

it('move_files with nothing given uses the moves.json code just saved in the chat folder', () => {
  const c = ctx(); const g = c.grants[0]
  expect(moveFiles.prepare!({} as never, c).moves ?? []).toEqual([])
  writeFileSync(join(c.chatDir, 'moves.json'), JSON.stringify([{ from: join(g, 'a'), to: join(g, 'b') }]))
  expect(moveFiles.prepare!({} as never, c).moves).toEqual([{ from: join(g, 'a'), to: join(g, 'b') }])
})
