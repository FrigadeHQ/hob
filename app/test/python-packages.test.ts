import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { TurnCtx } from '../src/main/agent/tool'
import { installedVersions, installPackages, nameOf, packageSpecProblem, sitePackagesOf } from '../src/main/python/packages'
import { runPython } from '../src/main/python/run'
import { installPackagesTool, pythonHint, runPythonTool } from '../src/main/tools/python'
import { prefix, python } from './python'

it('package names: plain PyPI names and pins only', () => {
  for (const ok of ['yfinance', 'yfinance==0.2.54', 'beautifulsoup4', 'pandas-ta==0.4.71b0', 'requests[socks]', 'ruamel.yaml']) expect(packageSpecProblem(ok)).toBeUndefined()
  for (const bad of ['-r req.txt', '--index-url=http://evil', 'git+https://x/y', './pkg', '/tmp/x.whl', 'a b', 'pkg>=1', 'https://evil/x.whl', '']) expect(packageSpecProblem(bad)).toBeDefined()
  expect(nameOf('Beautiful_Soup4[lxml]==1.0')).toBe('beautiful-soup4')
})

it('reads installed versions from dist-info folders; the first folder wins', () => {
  const a = mkdtempSync(join(tmpdir(), 'hob-site-')); const b = mkdtempSync(join(tmpdir(), 'hob-site-'))
  mkdirSync(join(a, 'yfinance-0.2.54.dist-info')); mkdirSync(join(a, 'numpy-2.5.4.dist-info'))
  mkdirSync(join(b, 'numpy-2.5.3.dist-info')); mkdirSync(join(b, 'python_dateutil-2.9.0.post0.dist-info'))
  const v = installedVersions([a, b])
  expect(v.get('yfinance')).toBe('0.2.54')
  expect(v.get('numpy')).toBe('2.5.4')
  expect(v.get('python-dateutil')).toBe('2.9.0.post0')
})

it('install makes the venv once, then only runs pip; bad names never reach pip', async () => {
  const venv = join(mkdtempSync(join(tmpdir(), 'hob-venv-')), 'packages')
  const calls: string[][] = []
  const exec = async (_cmd: string, args: string[]) => { calls.push(args) }
  expect(await installPackages('/py', venv, '3.12.14', ['--index-url=http://evil'], exec)).toMatchObject({ ok: false })
  expect(calls).toHaveLength(0)
  expect(await installPackages('/py', venv, '3.12.14', ['tabulate'], exec)).toEqual({ ok: true })
  expect(calls[0]).toEqual(['-m', 'venv', '--system-site-packages', '--without-pip', venv])
  expect(calls[1]).toContain('--only-binary=:all:')
  expect(calls[1].at(-1)).toBe('tabulate')
  calls.length = 0
  await installPackages('/py', venv, '3.12.14', ['six'], exec)
  expect(calls.map((c) => c[1])).toEqual(['pip'])
  // a new Hob Python remakes it
  calls.length = 0
  await installPackages('/py', venv, '3.13.0', ['six'], exec)
  expect(calls[0][1]).toBe('venv')
})

it('a failed install says why in plain words', async () => {
  const venv = join(mkdtempSync(join(tmpdir(), 'hob-venv-')), 'packages')
  const fail = (msg: string) => async (_c: string, args: string[]) => { if (args[1] === 'pip') throw new Error(msg) }
  expect(await installPackages('/py', venv, '1', ['nope-x'], fail('ERROR: No matching distribution found for nope-x'))).toMatchObject({ ok: false, error: expect.stringContaining('prebuilt') })
})

it("run_python's hint for a missing module points to install_packages", () => {
  expect(pythonHint("ModuleNotFoundError: No module named 'yfinance'")).toContain('install_packages')
})

describe('install_packages tool', () => {
  const ctx = (o: Partial<TurnCtx> = {}) => {
    const installed: string[][] = []
    const python = { isReady: () => true, ensure: async () => '/py', installPackages: async (s: string[]) => { installed.push(s); return { ok: true as const, versions: { yfinance: '0.2.54' } } } }
    return { c: { untrusted: false, webAccess: true, python, ...o } as unknown as TurnCtx, installed }
  }
  it('installs without asking, like any code step; needs Web access', async () => {
    const { c, installed } = ctx()
    expect(installPackagesTool.refuse!({ packages: ['yfinance'] }, c)).toBeUndefined()
    expect(installPackagesTool.action({ packages: ['yfinance'] }, c)).toEqual({ kind: 'run' })
    expect(installPackagesTool.action({ packages: ['yfinance'] }, { ...c, untrusted: true })).toEqual({ kind: 'run' })
    expect(installPackagesTool.refuse!({ packages: ['yfinance'] }, { ...c, webAccess: false })).toMatch(/Web access/)
    const out = await installPackagesTool.run({ packages: ['yfinance'] }, c)
    expect(out.failed).toBeFalsy()
    expect(out.text).toContain('yfinance 0.2.54')
    expect(installed).toEqual([['yfinance']])
    expect(installPackagesTool.title({ packages: ['yfinance', 'ta'] })).toBe('Installed yfinance and ta')
  })
})

// a real install from PyPI into a venv on the test machine's Python, then sandboxed code imports it
const exec = (cmd: string, args: string[]) => new Promise<void>((res, rej) => execFile(cmd, args, (err, _o, e) => (err ? rej(new Error(`${err.message}\n${e}`)) : res())))

describe.skipIf(!python || !!process.env.HOB_OFFLINE)('installing from PyPI', () => {
  it('installs a package and sandboxed code can import it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hob-pypi-'))
    const venv = join(root, 'packages')
    expect(await installPackages(python, venv, 'test', ['cowsay==6.1'], exec)).toEqual({ ok: true })
    const site = sitePackagesOf(venv)
    expect(installedVersions([site]).get('cowsay')).toBe('6.1')
    const chat = join(root, 'chat'); mkdirSync(chat)
    writeFileSync(join(chat, 'x.txt'), '')
    const r = await runPython({ python, runtimeRoot: prefix, cwd: chat, tmpDir: join(root, 'tmp'), packages: site,
      code: "import cowsay\nopen('t.txt','w').write(cowsay.get_output_string('cow', '1'))\nprint('ok')" })
    expect(r.output).toContain('ok')
    expect(readFileSync(join(chat, 't.txt'), 'utf8')).toContain('1')
  }, 180_000)
})

describe('run_python with internet', () => {
  const c = (o: Partial<TurnCtx> = {}) => ({ untrusted: false, webAccess: true, ...o } as unknown as TurnCtx)
  it('needs Web access but no OK, even after web content', () => {
    expect(runPythonTool.refuse!({ code: 'x', internet: true }, c({ webAccess: false }))).toMatch(/Web access/)
    expect(runPythonTool.refuse!({ code: 'x' }, c({ webAccess: false }))).toBeUndefined()
    expect(runPythonTool.action({ code: 'x', internet: true }, c())).toEqual({ kind: 'run' })
    expect(runPythonTool.action({ code: 'x', internet: true }, c({ untrusted: true }))).toEqual({ kind: 'run' })
    expect(runPythonTool.action({ code: 'x' }, c({ untrusted: true }))).toEqual({ kind: 'run' })
  })
  it('a network error tells the model to pass internet: true', () => {
    expect(pythonHint('urllib.error.URLError: <urlopen error [Errno 8] nodename nor servname provided, or not known>')).toContain('internet: true')
    expect(pythonHint("curl: (6) Could not resolve host: query2.finance.yahoo.com")).toContain('internet: true')
    expect(pythonHint('PermissionError: [Errno 1] Operation not permitted', "import socket")).not.toContain('only save in the chat folder')
  })
})
