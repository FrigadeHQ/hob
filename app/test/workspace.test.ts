import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { copyIn, isInside, newChatDir, TooBigError } from '../src/main/workspace'

const tmp = () => mkdtempSync(join(tmpdir(), 'hob-ws-'))

describe('isInside', () => {
  it('accepts the root, children and not-yet-existing children', () => {
    const r = tmp(); mkdirSync(join(r, 'a'))
    expect(isInside(r, r)).toBe(true)
    expect(isInside(r, join(r, 'a'))).toBe(true)
    expect(isInside(r, join(r, 'a', 'new', 'file.txt'))).toBe(true)
  })
  it('rejects traversal, prefix siblings and symlinks that leave the root', () => {
    const base = tmp(); const r = join(base, 'b'); mkdirSync(r); mkdirSync(join(base, 'bc'))
    expect(isInside(r, join(r, '..', 'bc'))).toBe(false)
    expect(isInside(r, join(base, 'bc', 'x'))).toBe(false)
    symlinkSync(base, join(r, 'link'))
    expect(isInside(r, join(r, 'link', 'bc'))).toBe(false)
  })
})

describe('copyIn', () => {
  it('copies files without touching the original and avoids name clashes', () => {
    const src = tmp(); const ws = tmp()
    writeFileSync(join(src, 'sales.csv'), 'a,b\n1,2\n')
    const [first] = copyIn(ws, [join(src, 'sales.csv')])
    const [second] = copyIn(ws, [join(src, 'sales.csv')])
    expect(first).toMatchObject({ name: 'sales.csv', path: join(ws, 'sales.csv'), sizeBytes: 8 })
    expect(second.name).toBe('sales (2).csv')
    writeFileSync(first.path, 'changed')
    expect(readFileSync(join(src, 'sales.csv'), 'utf8')).toBe('a,b\n1,2\n')
  })
  it('copies folders recursively, skipping symlinks', () => {
    const src = tmp(); const ws = tmp()
    mkdirSync(join(src, 'docs', 'sub'), { recursive: true })
    writeFileSync(join(src, 'docs', 'sub', 'a.txt'), 'hi')
    symlinkSync('/etc', join(src, 'docs', 'escape'))
    copyIn(ws, [join(src, 'docs')])
    expect(readFileSync(join(ws, 'docs', 'sub', 'a.txt'), 'utf8')).toBe('hi')
    expect(() => readFileSync(join(ws, 'docs', 'escape', 'hosts'))).toThrow()
  })
  it('refuses more than the size limit', () => {
    const src = tmp(); const ws = tmp()
    writeFileSync(join(src, 'big.bin'), Buffer.alloc(2000))
    expect(() => copyIn(ws, [join(src, 'big.bin')], 1000)).toThrow(TooBigError)
  })
})

it('newChatDir makes a unique dated folder', () => {
  const root = tmp(); const now = new Date(2026, 9, 15, 14, 32)
  expect(newChatDir(root, now)).toBe(join(root, '2026-10-15 14.32'))
  expect(newChatDir(root, now)).toBe(join(root, '2026-10-15 14.32 (2)'))
})

it('a dangling symlink inside the root that points outside is not inside', () => {
  const base = tmp(); const r = join(base, 'chat'); mkdirSync(r)
  symlinkSync(join(base, 'outside', 'evil.plist'), join(r, 'x'))
  expect(isInside(r, join(r, 'x'))).toBe(false)
  symlinkSync(join(r, 'later.txt'), join(r, 'ok-link'))
  expect(isInside(r, join(r, 'ok-link'))).toBe(true)
})

it('flags files that would run a program when opened', async () => {
  const { isRunnable } = await import('../src/main/workspace')
  for (const f of ['x.app', 'x.command', 'run.sh', 'a.tool', 'b.terminal', 'c.workflow', 'd.scpt', 'e.pkg', 'f.exe', 'g.bat', 'h.ps1', 'i.jar', 'j.py', 'k.webloc', 'l.inetloc', 'm.fileloc', 'X.COMMAND'])
    expect(isRunnable(f), f).toBe(true)
  for (const f of ['chart.png', 'summary.xlsx', 'notes.md', 'report.pdf']) expect(isRunnable(f), f).toBe(false)
})
