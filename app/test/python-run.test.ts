import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { capOutput, runPython } from '../src/main/python/run'

const [python, prefix] = (() => { try { return execFileSync('python3', ['-c', 'import sys, os; print(os.path.realpath(sys.executable)); print(os.path.realpath(sys.base_prefix))']).toString().trim().split('\n') } catch { return ['', ''] } })()
const dirs = () => ({ cwd: mkdtempSync(join(tmpdir(), 'hob-run-')), tmpDir: mkdtempSync(join(tmpdir(), 'hob-tmp-')) })

describe.skipIf(!python)('runPython', () => {
  // the interpreter's own install is the runtime, as in the app
  const base = () => ({ python, runtimeRoot: prefix, ...dirs() })
  it('returns printed output and the exit code', async () => {
    const r = await runPython({ ...base(), code: 'print(6*7)' })
    expect(r).toMatchObject({ exitCode: 0, timedOut: false, stopped: false })
    expect(r.output.trim()).toBe('42')
  })
  it('returns tracebacks so the model can fix its code', async () => {
    const r = await runPython({ ...base(), code: 'raise ValueError("bad column")' })
    expect(r.exitCode).not.toBe(0)
    expect(r.output).toContain('ValueError: bad column')
  })
  it('kills code that runs too long', async () => {
    const r = await runPython({ ...base(), code: 'import time\ntime.sleep(30)', timeoutMs: 300 })
    expect(r.timedOut).toBe(true)
  })
  it('stops when the user presses Stop', async () => {
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 200)
    const r = await runPython({ ...base(), code: 'import time\ntime.sleep(30)', signal: ac.signal })
    expect(r.stopped).toBe(true)
  })
  it.runIf(process.platform === 'darwin')('sandbox: writes only in the chat folder, no network', async () => {
    const b = base()
    const outside = join(tmpdir(), `hob-escape-${Date.now()}.txt`)
    const code = [
      "open('inside.txt','w').write('ok')",
      `try:\n  open(${JSON.stringify(outside)},'w').write('x'); print('WROTE')\nexcept Exception as e: print('blocked-write')`,
      "import urllib.request\ntry:\n  urllib.request.urlopen('https://example.com', timeout=5); print('NET')\nexcept Exception: print('blocked-net')",
    ].join('\n')
    const r = await runPython({ ...b, code })
    expect(readFileSync(join(b.cwd, 'inside.txt'), 'utf8')).toBe('ok')
    expect(r.output).toContain('blocked-write')
    expect(r.output).toContain('blocked-net')
    expect(existsSync(outside)).toBe(false)
  })
  it.runIf(process.platform === 'darwin')('sandbox: cannot launch apps or scripts outside it (open, osascript)', async () => {
    const b = base()
    const marker = join(tmpdir(), `hob-launched-${Date.now()}`)
    const code = [
      'import subprocess',
      `open('x.command','w').write('#!/bin/sh\\ntouch ${marker}\\n')`,
      'import os; os.chmod("x.command", 0o755)',
      "for cmd in (['/usr/bin/open', 'x.command'], ['/usr/bin/osascript', '-e', 'return 1']):",
      '  try:',
      '    r = subprocess.run(cmd, capture_output=True, timeout=10); print(cmd[0], "rc", r.returncode)',
      '  except Exception as e: print(cmd[0], "blocked", type(e).__name__)',
    ].join('\n')
    const r = await runPython({ ...b, code })
    await new Promise((res) => setTimeout(res, 1500))
    expect(existsSync(marker)).toBe(false)
    expect(r.output).toMatch(/\/usr\/bin\/open blocked|\/usr\/bin\/open rc [^0]/)
    expect(r.output).toMatch(/osascript blocked|osascript rc [^0]/)
  })
  it.runIf(process.platform === 'darwin')('sandbox: cannot read other temp folders or shared user folders', async () => {
    const b = base()
    const other = mkdtempSync(join(tmpdir(), 'hob-other-'))
    writeFileSync(join(other, 'secret.txt'), 'secret')
    const code = `try:\n  print(open(${JSON.stringify(join(other, 'secret.txt'))}).read())\nexcept Exception as e: print('blocked-read')`
    const r = await runPython({ ...b, code })
    expect(r.output).toContain('blocked-read')
  })
  it('a granted folder that no longer exists does not break code runs', async () => {
    const r = await runPython({ ...base(), code: 'print("ok")', readPaths: [join(tmpdir(), 'gone-' + Date.now())] })
    expect(r.output.trim()).toBe('ok')
  })
})

it('caps long output, keeping the start and the end', () => {
  const s = 'a'.repeat(5000) + 'b'.repeat(5000)
  const c = capOutput(s, 1000)
  expect(c.length).toBeLessThan(1100)
  expect(c.startsWith('aaa')).toBe(true)
  expect(c.endsWith('bbb')).toBe(true)
  expect(c).toContain('characters cut')
})
