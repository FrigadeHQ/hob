import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { TurnCtx } from '../src/main/agent/tool'
import { PluginRegistry } from '../src/main/plugins/registry'
import { saveSkillTool, type SkillSource } from '../src/main/plugins/skillTools'
import { runPythonTool } from '../src/main/tools/python'
import { Store } from '../src/main/store'
import { skillOffer } from '../src/shared/skillOffer'
import type { Step } from '../src/shared/agent'
import { prefix, python } from './python'

let reg: PluginRegistry | undefined
afterEach(() => reg?.close())

function world() {
  const root = mkdtempSync(join(tmpdir(), 'mabel-skillscripts-'))
  const builtinDir = join(root, 'builtin'); const installDir = join(root, 'installed')
  mkdirSync(builtinDir); mkdirSync(installDir)
  const store = new Store(':memory:')
  const make = () => (reg = new PluginRegistry({
    builtinDir, installDir, store, native: {}, reserved: ['run_python'],
    bound: { web: { get: () => true, set: () => {} } },
    crypt: { encrypt: (s) => s, decrypt: (s) => s },
    path: async () => process.env.PATH ?? '',
  }))
  return { root, builtinDir, installDir, make }
}

const source = (r: PluginRegistry): SkillSource => ({ skills: () => r.skills(), findSkill: (n) => r.findSkill(n), saveSkill: (s, o) => r.saveSkill(s, o) })
const PY = 'import sys\nprint(sys.argv[1:])\n'

describe('saving skills with scripts', () => {
  it('writes the scripts next to SKILL.md and marks internet use', () => {
    const w = world(); const r = w.make()
    expect(r.saveSkill({ name: 'spending', description: 'Monthly spending chart', instructions: 'Run the script.', files: { 'make_report.py': PY, 'notes.md': 'x' }, network: true })).toMatchObject({ ok: true, name: 'spending' })
    const s = r.findSkill('spending')!
    expect(readFileSync(join(s.dir, 'make_report.py'), 'utf8')).toBe(PY)
    expect(existsSync(join(s.dir, 'notes.md'))).toBe(true)
    expect(s.network).toBe(true)
  })

  it('rejects unsafe or oversized files', () => {
    const w = world(); const r = w.make()
    const save = (files: Record<string, string>) => r.saveSkill({ name: 'x', description: 'd', instructions: 'i', files })
    expect(save({ '../evil.py': PY })).toMatchObject({ ok: false })
    expect(save({ 'sub/a.py': PY })).toMatchObject({ ok: false })
    expect(save({ 'SKILL.md': 'hi' })).toMatchObject({ ok: false })
    expect(save({ 'run.sh': 'rm -rf ~' })).toMatchObject({ ok: false })
    expect(save({ 'big.py': 'x'.repeat(100_001) })).toMatchObject({ ok: false })
    expect(save(Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`f${i}.py`, PY])))).toMatchObject({ ok: false })
    expect(r.findSkill('x')).toBeUndefined()
  })

  it('replacing keeps scripts and internet use the edit leaves out; a clash without replace fails', () => {
    const w = world(); const r = w.make()
    r.saveSkill({ name: 'spending', description: 'd', instructions: 'v1', files: { 'a.py': PY }, network: true })
    expect(r.saveSkill({ name: 'spending', description: 'd', instructions: 'v2' })).toMatchObject({ ok: false })
    r.saveSkill({ name: 'spending', description: 'd', instructions: 'v2' }, { replace: true })
    const s = r.findSkill('spending')!
    expect(s.body).toContain('v2')
    expect(existsSync(join(s.dir, 'a.py'))).toBe(true)
    expect(s.network).toBe(true)
  })

  it("a plugin's skill gets the internet only if the plugin asked for it", () => {
    const w = world()
    for (const [id, net] of [['quiet', false], ['online', true]] as const) {
      const dir = join(w.installDir, id)
      mkdirSync(join(dir, 'skills', `${id}-skill`), { recursive: true })
      writeFileSync(join(dir, 'mabel-plugin.json'), JSON.stringify({ id, name: id, permissions: { network: net } }))
      writeFileSync(join(dir, 'skills', `${id}-skill`, 'SKILL.md'), `---\nname: ${id}-skill\ndescription: d\nnetwork: true\n---\nGo.`)
    }
    const r = w.make()
    expect(r.findSkill('quiet-skill')?.network).toBe(false)
    expect(r.findSkill('online-skill')?.network).toBe(true)
  })
})

describe('save_skill tool', () => {
  it('shows the instructions and code on the card, and says when it replaces or uses the internet', () => {
    const w = world(); const r = w.make()
    const t = saveSkillTool(source(r))
    const a = { name: 'spending', description: 'Monthly spending chart', instructions: 'Run make_report.py.', files: { 'make_report.py': PY }, network: true }
    expect(t.ask!(a)).toContain('/spending')
    expect(t.ask!(a)).toContain('internet')
    const detail = t.askDetail!(a)
    expect(detail).toContain('Run make_report.py.')
    expect(detail).toContain('make_report.py')
    expect(detail).toContain('print(sys.argv[1:])')
    r.saveSkill({ name: 'spending', description: 'd', instructions: 'old' })
    expect(t.ask!({ ...a, replace: true })).toMatch(/Replace/)
  })

  it('refuses after web content in the same message, before asking', () => {
    const w = world(); const r = w.make()
    const t = saveSkillTool(source(r))
    expect(t.refuse!({} as never, { untrusted: true } as TurnCtx)).toMatch(/new message/)
    expect(t.refuse!({} as never, { untrusted: false } as TurnCtx)).toBeUndefined()
  })

  it('adds a line on how to run the scripts when the steps leave it out', async () => {
    const w = world(); const r = w.make()
    await saveSkillTool(source(r)).run({ name: 'spending', description: 'd', instructions: 'Make the chart.', files: { 'make_report.py': PY } }, {} as never)
    expect(r.findSkill('spending')!.body).toContain('script "spending/make_report.py"')
  })
})


describe.skipIf(!python)('run_python with a skill script', () => {
  function setup(network = false, webAccess = true) {
    const w = world(); const r = w.make()
    r.saveSkill({ name: 'spending', description: 'd', instructions: 'i', network, files: {
      'make_report.py': "import sys, os\nrate = open(os.path.join(os.path.dirname(__file__), 'rate.txt')).read()\nopen('report.txt', 'w').write(rate + ' ' + ' '.join(sys.argv[1:]))\nprint('done', sys.argv[1:])\n",
      'rate.txt': '1.5',
    } })
    const root = mkdtempSync(join(tmpdir(), 'mabel-skillrun-'))
    const chatDir = join(root, 'chat'); mkdirSync(chatDir)
    const ctx: TurnCtx = {
      chatDir, grants: [], signal: new AbortController().signal, untrusted: false, webAccess, journal: undefined as never,
      trash: async () => {}, runTmp: join(root, 'tmp'), fetch,
      python: { python, dir: prefix, isReady: () => true, ensure: async () => python } as never,
      skillScript: (ref) => {
        const m = /^([a-z0-9-]+)\/([^/\\]+\.py)$/.exec(ref)
        const s = m ? r.findSkill(m[1]) : r.skills().find((x) => ref.startsWith(x.dir))
        if (!s) return undefined
        return { path: m ? join(s.dir, m[2]) : ref, dir: s.dir, network: !!s.network }
      },
    }
    return { r, ctx, chatDir }
  }

  it('runs the script with args; it reads files next to it and saves in the chat folder', async () => {
    const { ctx, chatDir } = setup()
    const a = { script: 'spending/make_report.py', args: ['march.csv'] }
    expect(runPythonTool.title(a)).toBe('Ran make_report.py')
    const out = await runPythonTool.run(a, ctx)
    expect(out.failed).toBe(false)
    expect(out.text).toContain("done ['march.csv']")
    expect(readFileSync(join(chatDir, 'report.txt'), 'utf8')).toBe('1.5 march.csv')
    expect(out.files).toEqual([join(chatDir, 'report.txt')])
  })

  it('only runs .py files inside a skill folder', async () => {
    const { ctx, chatDir } = setup()
    writeFileSync(join(chatDir, 'x.py'), PY)
    expect((await runPythonTool.run({ script: join(chatDir, 'x.py') }, ctx)).failed).toBe(true)
    expect((await runPythonTool.run({ script: 'spending/nope.py' }, ctx)).failed).toBe(true)
    expect((await runPythonTool.run({ script: 'spending/rate.txt' }, ctx)).failed).toBe(true)
  })

  it('an internet skill is a web action and marks the turn untrusted', async () => {
    const { ctx } = setup(true)
    const a = { script: 'spending/make_report.py', args: [] }
    expect(runPythonTool.action(a, ctx)).toEqual({ kind: 'web' })
    expect(runPythonTool.action({ code: 'print(1)' }, ctx)).toEqual({ kind: 'run' })
    await runPythonTool.run(a, ctx)
    expect(ctx.untrusted).toBe(true)
  })
})

describe('offering to save a skill', () => {
  const done = (tool: string): Step => ({ id: tool + Math.random(), title: tool, status: 'done', tool })
  const work = [done('read_file'), done('run_python'), done('make_chart')]
  const user = (content: string) => ({ role: 'user' as const, content, steps: [] as Step[] })
  const bot = (steps: Step[]) => ({ role: 'assistant' as const, content: 'Done.', steps })

  it('offers once, on the first reply that did real multi-step work with code', () => {
    expect(skillOffer([user('chart this'), bot(work)], [])).toBe(1)
    expect(skillOffer([user('hi'), bot([done('read_file')])], [])).toBe(-1)
    expect(skillOffer([user('a'), bot([done('read_file'), done('write_file'), done('list_files')])], [])).toBe(-1)
    // a later reply never gets it, even when it qualifies too
    expect(skillOffer([user('chart this'), bot(work), user('again'), bot(work)], [])).toBe(-1)
  })

  it("doesn't offer for a skill run, after a skill was saved, or when the steps failed", () => {
    expect(skillOffer([user('/spending march.csv'), bot(work)], ['spending'])).toBe(-1)
    expect(skillOffer([user('a'), bot([...work, done('save_skill')])], [])).toBe(-1)
    expect(skillOffer([user('a'), bot([done('read_file'), done('make_chart'), { ...done('run_python'), status: 'error' }])], [])).toBe(-1)
  })
})

describe('skills that need packages', () => {
  it('saving pins each package to the installed version and lists them on the card', async () => {
    const w = world(); const r = w.make()
    const t = saveSkillTool(source(r))
    const a = { name: 'stocks', description: 'd', instructions: 'Run fetch.py.', packages: ['yfinance', 'ta==0.11.0'] }
    expect(t.askDetail!(a)).toContain('Packages: yfinance, ta==0.11.0')
    const python = { versions: (ns: string[]) => Object.fromEntries(ns.map((n) => [n, n.startsWith('yfinance') ? '0.2.54' : undefined])) }
    await t.run(a, { python } as never)
    expect(r.findSkill('stocks')!.packages).toEqual(['yfinance==0.2.54', 'ta==0.11.0'])
  })

  it('bad package names are refused', () => {
    const w = world(); const r = w.make()
    expect(r.saveSkill({ name: 'x', description: 'd', instructions: 'i', packages: ['--index-url=http://evil'] })).toMatchObject({ ok: false })
  })

  it("running a skill's script installs its missing packages first; with Web access off it says so", async () => {
    const root = mkdtempSync(join(tmpdir(), 'mabel-skillpk-'))
    const dir = join(root, 'stocks'); mkdirSync(dir); writeFileSync(join(dir, 'fetch.py'), "print('hi')\n")
    const installs: string[][] = []
    const python = { isReady: () => true, ensure: async () => 'python3', dir: root, sitePackages: () => join(root, 'none'),
      versions: (ns: string[]) => Object.fromEntries(ns.map((n) => [n, undefined])),
      installPackages: async (s: string[]) => { installs.push(s); return { ok: false as const, error: 'stop here' } } }
    const ctx = { chatDir: root, grants: [], webAccess: false, untrusted: false, runTmp: join(root, 'tmp'), python,
      skillScript: () => ({ path: join(dir, 'fetch.py'), dir, network: false, packages: ['yfinance==0.2.54'] }) } as unknown as TurnCtx
    const off = await runPythonTool.run({ script: 'stocks/fetch.py' }, ctx)
    expect(off.failed).toBe(true)
    expect(off.text).toMatch(/Web access/)
    expect(installs).toHaveLength(0)
    const on = await runPythonTool.run({ script: 'stocks/fetch.py' }, { ...ctx, webAccess: true } as TurnCtx)
    expect(installs).toEqual([['yfinance==0.2.54']])
    expect(on.text).toContain('stop here')
  })
})
