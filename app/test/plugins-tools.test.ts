import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { TurnCtx } from '../src/main/agent/tool'
import { sandboxProfile } from '../src/main/python/run'
import { fillTitle, mcpOutput, pythonTool, safeToolName } from '../src/main/plugins/tools'

const [python, prefix] = (() => { try { return execFileSync('python3', ['-c', 'import sys, os; print(os.path.realpath(sys.executable)); print(os.path.realpath(sys.base_prefix))']).toString().trim().split('\n') } catch { return ['', ''] } })()

function ctx(): TurnCtx {
  const root = mkdtempSync(join(tmpdir(), 'hob-ptool-'))
  const chatDir = join(root, 'chat'); mkdirSync(chatDir)
  return {
    chatDir, grants: [], signal: new AbortController().signal, untrusted: false, webAccess: true, journal: undefined as never,
    trash: async () => {}, runTmp: join(root, 'tmp'), fetch,
    python: { python, dir: prefix, isReady: () => true, ensure: async () => python } as never,
  }
}

describe.skipIf(!python)('pythonTool', () => {
  it('passes args on stdin, settings as env, and returns JSON text + files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hob-plugin-'))
    writeFileSync(join(dir, 'helper.py'), 'def double(x): return x * 2\n')
    writeFileSync(join(dir, 'run.py'), [
      'import json, os, sys', 'from helper import double',
      'a = json.load(sys.stdin)',
      "open('out.txt', 'w').write('hi')",
      "print(json.dumps({'text': f\"{double(a['n'])} {os.environ['TOKEN']} {os.environ['HOB_PLUGIN_DIR'] == os.path.dirname(os.path.abspath(sys.argv[0]))}\", 'files': ['out.txt']}))",
    ].join('\n'))
    const t = pythonTool({ id: 'p', name: 'Doubler', dir, network: false, env: { TOKEN: 'abc' } }, { name: 'double', description: 'd', params: {}, run: 'run.py', title: 'Doubled {n}' })
    expect(t.title({ n: 21 })).toBe('Doubled 21')
    expect(t.action({}, {} as never)).toEqual({ kind: 'run' })
    const c = ctx()
    const out = await t.run({ n: 21 }, c)
    expect(out.text).toBe('42 abc True')
    expect(out.files).toEqual([join(c.chatDir, 'out.txt')])
    expect(existsSync(join(c.chatDir, 'out.txt'))).toBe(true)
  })
  it('a crash comes back as a failed step with the error for the model', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hob-plugin-'))
    writeFileSync(join(dir, 'run.py'), 'raise RuntimeError("no rates today")')
    const out = await pythonTool({ id: 'p', name: 'Money', dir, network: false, env: {} }, { name: 'x', description: 'd', params: {}, run: 'run.py' }).run({}, ctx())
    expect(out).toMatchObject({ failed: true, text: expect.stringContaining('no rates today') })
  })
  it('networked tools are web actions and mark the turn untrusted', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hob-plugin-'))
    writeFileSync(join(dir, 'run.py'), 'print("ok")')
    const t = pythonTool({ id: 'p', name: 'Net', dir, network: true, env: {} }, { name: 'x', description: 'd', params: {}, run: 'run.py' })
    expect(t.action({}, {} as never)).toEqual({ kind: 'web' })
    expect(t.needsWeb).toBe(true)
    const c = ctx()
    expect((await t.run({}, c)).text).toBe('ok')
    expect(c.untrusted).toBe(true)
  })
})

it('the sandbox allows network only when asked', () => {
  expect(sandboxProfile(0)).toContain('(deny network*)')
  expect(sandboxProfile(0, true)).not.toContain('(deny network*)')
})

it('helpers: titles, safe names, MCP output with images saved as files', () => {
  expect(fillTitle('Converted {amount} {from}', { amount: 5, from: 'EUR' })).toBe('Converted 5 EUR')
  expect(safeToolName('delete-note.v2')).toBe('delete_note_v2')
  const chatDir = mkdtempSync(join(tmpdir(), 'hob-mcpout-'))
  const r = mcpOutput({ content: [{ type: 'text', text: 'hello' }, { type: 'image', data: Buffer.from('x').toString('base64'), mimeType: 'image/png' }] }, { chatDir }, 'notes')
  expect(r.text).toMatch(/^hello\n\[image saved as notes-\d+-1\.png\]$/)
  expect(r.files).toHaveLength(1)
  expect(existsSync(r.files[0])).toBe(true)
})
