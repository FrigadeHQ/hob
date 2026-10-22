import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it } from 'vitest'
import { PY_PACKAGES, PythonRuntime, pythonBin, type RuntimeDeps } from '../src/main/python/runtime'

function fakeDeps(root: string, fail = false) {
  const calls: string[] = []
  const deps: RuntimeDeps = {
    async fetchFile(url, _sha, _gb, dir, onProgress, name = 'py.tgz') { calls.push(`fetch ${url.split('/').pop()}`); onProgress(1); const p = join(dir, name); writeFileSync(p, 'x'); return p },
    async exec(cmd, args) {
      calls.push(`${cmd.split(/[\\/]/).pop()} ${args.slice(0, 3).join(' ')}`)
      if (cmd === 'tar') { const bin = pythonBin(root, 'darwin'); mkdirSync(dirname(bin), { recursive: true }); writeFileSync(bin, '') }
      if (fail && args.includes('pip')) throw new Error('pip failed')
    },
  }
  return { deps, calls }
}

it('downloads, extracts, installs pinned packages once, then reports ready', async () => {
  const root = mkdtempSync(join(tmpdir(), 'garth-py-'))
  const { deps, calls } = fakeDeps(root)
  const rt = new PythonRuntime(root, deps, 'darwin-arm64')
  expect(rt.isReady()).toBe(false)
  const progress: number[] = []
  const [a, b] = await Promise.all([rt.ensure((f) => progress.push(f)), rt.ensure()])
  expect(a).toBe(rt.python); expect(b).toBe(rt.python)
  expect(calls.filter((c) => c.startsWith('fetch cpython'))).toHaveLength(1)
  expect(calls).toContain('python3 -m pip install')
  expect(rt.isReady()).toBe(true)
  expect(progress.at(-1)).toBe(1)
  await rt.ensure()
  expect(calls.filter((c) => c.startsWith('fetch cpython'))).toHaveLength(1)
  expect(PY_PACKAGES.every((p) => /==/.test(p))).toBe(true)
})

it('a failed install is not marked ready and can be retried', async () => {
  const root = mkdtempSync(join(tmpdir(), 'garth-py-'))
  const rt = new PythonRuntime(root, fakeDeps(root, true).deps, 'darwin-arm64')
  await expect(rt.ensure()).rejects.toThrow('pip failed')
  expect(rt.isReady()).toBe(false)
  expect(existsSync(join(root, 'ready.json'))).toBe(false)
})

it('unsupported platforms get a plain message', async () => {
  const root = mkdtempSync(join(tmpdir(), 'garth-py-'))
  await expect(new PythonRuntime(root, fakeDeps(root).deps, 'sunos-sparc').ensure()).rejects.toThrow('available on this computer')
})

it('pins every package the data stack pulls in, not just the top-level ones', () => {
  const names = PY_PACKAGES.map((p) => p.split('==')[0].toLowerCase())
  for (const dep of ['pillow', 'fonttools', 'contourpy', 'kiwisolver', 'lxml', 'python-dateutil', 'six', 'packaging', 'pyparsing', 'cycler', 'et_xmlfile', 'typing_extensions'])
    expect(names, dep).toContain(dep)
})

it('an install made with a different package list is not ready (reinstalls)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'garth-py-'))
  const rt = new PythonRuntime(root, fakeDeps(root).deps, 'darwin-arm64')
  await rt.ensure()
  const { writeFileSync: w } = await import('node:fs')
  w(join(root, 'ready.json'), JSON.stringify({ release: '20260929', packages: ['pandas==1.0'] })) // stale list
  expect(rt.isReady()).toBe(false)
})

it('also installs the pinned SearXNG source and its packages', async () => {
  const root = mkdtempSync(join(tmpdir(), 'garth-py-'))
  const { deps, calls } = fakeDeps(root)
  await new PythonRuntime(root, deps, 'darwin-arm64').ensure()
  expect(calls.some((c) => c.startsWith('fetch') && c.includes('4e2c1ea7f468c9d1b16206e9d4079999a2eb0627.tar.gz'))).toBe(true)
  expect(calls.filter((c) => c.startsWith('tar'))).toHaveLength(2)
  expect(PY_PACKAGES).toContain('flask==3.1.3')
  // "put it in a nice PDF" works without installing anything
  expect(PY_PACKAGES).toContain('fpdf2==2.8.9')
  expect(PY_PACKAGES).toContain('curl_cffi==0.16.3')
})
