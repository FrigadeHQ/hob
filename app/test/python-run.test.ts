import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { capOutput, runPython } from '../src/main/python/run'

const [python, prefix] = (() => {
  for (const cmd of ['python3', 'python']) {
    try { return execFileSync(cmd, ['-c', 'import sys, os; print(os.path.realpath(sys.executable)); print(os.path.realpath(sys.base_prefix))']).toString().trim().split(/\r?\n/) } catch { /* try the next name */ }
  }
  return ['', '']
})()
/** Linux: the kernel's Landlock sandbox (5.13+); network limits need 6.7+ */
const landlock = (() => {
  if (process.platform !== 'linux' || !python) return 0
  try { return Number(execFileSync(python, ['-c', 'import ctypes; print(ctypes.CDLL(None, use_errno=True).syscall(444, None, 0, 1))']).toString().trim()) } catch { return 0 }
})()
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
  // Mac: sandbox-exec. Linux: Landlock. Windows: low integrity (writes only; reads and network stay open)
  it.runIf(process.platform === 'darwin' || landlock > 0 || process.platform === 'win32')('sandbox: writes only in the chat folder, no network', async () => {
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
    if (process.platform === 'darwin' || landlock >= 4) expect(r.output).toContain('blocked-net')
    expect(existsSync(outside)).toBe(false)
  }, 30_000) // the first run on Windows makes the low-integrity copy of Python
  it.runIf(process.platform === 'darwin' || landlock > 0 || process.platform === 'win32')('sandbox: SQLite works in the chat folder and temp (it looks up each parent folder); files beside them stay unreadable', async () => {
    const b = base()
    const secret = join(dirname(b.cwd), `hob-secret-${Date.now()}.txt`)
    writeFileSync(secret, 'secret')
    const code = [
      "import os, sqlite3, tempfile",
      "c = sqlite3.connect('data.db'); c.execute('create table t(a)'); c.commit(); print('db-ok')",
      "c = sqlite3.connect(os.path.join(tempfile.gettempdir(), 'cache.db')); c.execute('create table t(a)'); print('tmpdb-ok')",
      `try:\n  open(${JSON.stringify(secret)}).read(); print('READ')\nexcept Exception: print('blocked-read')`,
    ].join('\n')
    const r = await runPython({ ...b, code })
    expect(r.output).toContain('db-ok')
    expect(r.output).toContain('tmpdb-ok')
    if (process.platform !== 'win32') expect(r.output).toContain('blocked-read')
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
  it.runIf(process.platform === 'linux' && landlock > 0)('sandbox: cannot start other programs (Linux)', async () => {
    const marker = join(tmpdir(), `hob-launched-${Date.now()}`)
    const code = `import subprocess\ntry:\n  subprocess.run(['/bin/sh', '-c', 'touch ${marker}'], timeout=10); print('ran')\nexcept Exception as e: print('blocked', type(e).__name__)`
    const r = await runPython({ ...base(), code })
    expect(r.output).toContain('blocked')
    expect(existsSync(marker)).toBe(false)
  })
  it('a plugin may use the internet when allowed', async () => {
    const r = await runPython({ ...base(), code: 'import socket\ns = socket.socket()\ns.settimeout(5)\ntry:\n  s.connect(("example.com", 80)); print("connected")\nexcept Exception as e: print("failed", e)', network: true })
    // a network hiccup on the test machine shouldn't fail this; being blocked by the sandbox would
    expect(r.output).not.toMatch(/Permission denied|PermissionError|Operation not permitted/)
  })
  it.runIf(process.platform === 'darwin' || landlock > 0)('sandbox: cannot read other temp folders or shared user folders', async () => {
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
