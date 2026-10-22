import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Tool } from '../src/main/agent/tool'
import { PluginRegistry, parseCommandLine } from '../src/main/plugins/registry'
import { Store } from '../src/main/store'

const fixture = join(import.meta.dirname, 'fixtures/mcp-server.mjs')
const nativeTool = (name: string): Tool => ({ spec: { name, description: `${name} tool`, params: { type: 'object', properties: {} } }, title: () => name, action: () => ({ kind: 'run' }), run: async () => ({ text: name }) })

function plugin(root: string, id: string, manifest: Record<string, unknown>, skills: Record<string, string> = {}) {
  const dir = join(root, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'hob-plugin.json'), JSON.stringify({ id, name: id, ...manifest }))
  for (const [n, body] of Object.entries(skills)) { mkdirSync(join(dir, 'skills', n), { recursive: true }); writeFileSync(join(dir, 'skills', n, 'SKILL.md'), body) }
  return dir
}

let reg: PluginRegistry | undefined
afterEach(() => reg?.close())

function world(o: { web?: { on: boolean } } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'hob-plugins-'))
  const builtinDir = join(root, 'builtin'); const installDir = join(root, 'installed')
  mkdirSync(builtinDir); mkdirSync(installDir)
  const store = new Store(':memory:')
  const web = o.web ?? { on: true }
  const make = () => (reg = new PluginRegistry({
    builtinDir, installDir, store,
    native: { get_weather: nativeTool('get_weather'), web_search: nativeTool('web_search') },
    reserved: ['read_file', 'run_python'],
    bound: { web: { get: () => web.on, set: (on) => { web.on = on } } },
    crypt: { encrypt: (s) => `enc:${s}`, decrypt: (s) => s.replace(/^enc:/, '') },
    path: async () => process.env.PATH ?? '',
  }))
  return { root, builtinDir, installDir, store, make, web }
}

describe('PluginRegistry', () => {
  it('loads built-in plugins with skills, starters and native tools', async () => {
    const w = world()
    plugin(w.builtinDir, 'weather', { icon: 'sun', permissions: { network: true }, tools: [{ native: 'get_weather' }], starters: [{ title: 'Rain?', prompt: 'Will it rain?' }], prompt: 'For weather, use get_weather.' })
    plugin(w.builtinDir, 'trip', {}, { 'plan-trip': '---\nname: plan-trip\ndescription: Plan trips\n---\nDo it day by day.' })
    // tools built into Hob run no plugin code
    plugin(w.builtinDir, 'cal', { tools: [{ native: 'calendar_events' }] })
    const r = w.make()
    expect(r.list().map((p) => [p.id, p.enabled, p.trust])).toEqual([['cal', true, 'builtin'], ['trip', true, 'instructions'], ['weather', true, 'network']])
    expect((await r.tools()).map((t) => t.spec.name)).toEqual(['get_weather'])
    expect(r.skills().map((s) => s.name)).toEqual(['plan-trip'])
    expect(r.findSkill('plan-trip')?.body).toBe('Do it day by day.')
    expect(r.starters()).toEqual([{ title: 'Rain?', prompt: 'Will it rain?', icon: 'sun', pluginId: 'weather' }])
    expect(r.prompts()).toEqual(['For weather, use get_weather.'])
  })

  it('a broken plugin is listed with its error and stays off', async () => {
    const w = world()
    mkdirSync(join(w.installDir, 'broken'))
    writeFileSync(join(w.installDir, 'broken', 'hob-plugin.json'), '{ not json')
    plugin(w.installDir, 'sneaky', { tools: [{ native: 'web_search' }] })
    const r = w.make()
    const broken = r.list().find((p) => p.id === 'broken')!
    expect(broken).toMatchObject({ enabled: false, error: expect.stringContaining('hob-plugin.json') })
    // only plugins that ship with Hob may use Hob's own code
    expect(r.list().find((p) => p.id === 'sneaky')).toMatchObject({ enabled: false, error: expect.stringContaining('native') })
    expect(await r.tools()).toEqual([])
  })

  it('turning a plugin off removes its tools, skills and starters, and is remembered', async () => {
    const w = world()
    plugin(w.builtinDir, 'trip', { starters: [{ title: 'Go', prompt: 'go' }] }, { 'plan-trip': '---\ndescription: Plan\n---\nx' })
    w.make().setEnabled('trip', false)
    reg!.close()
    const r = w.make()
    expect(r.list()[0].enabled).toBe(false)
    expect(r.skills()).toEqual([])
    expect(r.starters()).toEqual([])
  })

  it('the Web plugin switch is the Web access setting', () => {
    const w = world({ web: { on: true } })
    plugin(w.builtinDir, 'web', { tools: [{ native: 'web_search' }] })
    const r = w.make()
    r.setEnabled('web', false)
    expect(w.web.on).toBe(false)
    expect(r.list()[0].enabled).toBe(false)
  })

  it('renames a plugin tool that clashes with a built-in or another plugin', async () => {
    const w = world()
    writeFileSync(join(plugin(w.installDir, 'alpha', { tools: [{ name: 'read_file', description: 'x', run: 'a.py' }, { name: 'shared', description: 'x', run: 'a.py' }] }), 'a.py'), '')
    writeFileSync(join(plugin(w.installDir, 'beta', { tools: [{ name: 'shared', description: 'y', run: 'b.py' }] }), 'b.py'), '')
    expect((await w.make().tools()).map((t) => t.spec.name)).toEqual(['alpha_read_file', 'shared', 'beta_shared'])
  })

  it('saveSkill writes the user\'s own skill and updates it on save again', () => {
    const w = world()
    const r = w.make()
    expect(r.saveSkill({ name: 'Weekly report', description: 'My weekly report', instructions: 'Use bullets.' })).toEqual({ ok: true, id: 'my-skills', name: 'weekly-report' })
    r.saveSkill({ name: 'weekly-report', description: 'My weekly report', instructions: 'Use a table.' }, { replace: true })
    expect(r.findSkill('weekly-report')?.body).toBe('Use a table.')
    expect(r.list().find((p) => p.id === 'my-skills')).toMatchObject({ name: 'My skills', source: 'installed' })
    expect(r.saveSkill({ name: '!!!', description: 'x', instructions: 'y' })).toMatchObject({ ok: false })
  })

  it('installs from a folder, keeps secrets encrypted, passes settings to tools, and removes', async () => {
    const w = world()
    const src = plugin(join(w.root, 'downloads'), 'notes', { settings: [{ key: 'TOKEN', label: 'Token', secret: true }, { key: 'REGION', label: 'Region' }] })
    const r = w.make()
    expect(r.install(src)).toEqual({ ok: true, id: 'notes' })
    expect(existsSync(join(w.installDir, 'notes', 'hob-plugin.json'))).toBe(true)
    r.setSetting('notes', 'TOKEN', 's3cret')
    r.setSetting('notes', 'REGION', 'eu')
    expect(w.store.pluginSettings('notes').TOKEN).toBe('enc:s3cret')
    expect(r.list()[0].settings).toEqual([
      { key: 'TOKEN', label: 'Token', secret: true, set: true, kind: 'text', required: false, multiple: false },
      { key: 'REGION', label: 'Region', secret: false, set: true, kind: 'text', required: false, multiple: false, value: 'eu' },
    ])
    expect(r.envFor('notes')).toEqual({ TOKEN: 's3cret', REGION: 'eu' })
    r.remove('notes')
    expect(existsSync(join(w.installDir, 'notes'))).toBe(false)
    expect(r.list()).toEqual([])
  })

  it('links a developer folder in place', () => {
    const w = world()
    const dev = plugin(join(w.root, 'code'), 'dev-thing', { description: 'v1' })
    const r = w.make()
    expect(r.link(dev)).toEqual({ ok: true, id: 'dev-thing' })
    expect(r.list()[0]).toMatchObject({ source: 'linked', dir: dev })
    writeFileSync(join(dev, 'hob-plugin.json'), JSON.stringify({ id: 'dev-thing', name: 'dev-thing', description: 'v2' }))
    r.reload()
    expect(r.list()[0].description).toBe('v2')
  })

  it('connects an MCP server and offers its tools; destructive ones ask', async () => {
    const w = world()
    const r = w.make()
    const res = r.connectApp({ name: 'Fixture notes', command: `${JSON.stringify(process.execPath)} ${JSON.stringify(fixture)}`, env: 'ELECTRON_RUN_AS_NODE=1' })
    expect(res).toEqual({ ok: true, id: 'fixture-notes' })
    const tools = await r.tools()
    expect(tools.map((t) => t.spec.name)).toEqual(['echo', 'delete_note'])
    expect(tools[1].action({}, {} as never)).toEqual({ kind: 'app', ask: true })
    expect(r.list()[0]).toMatchObject({ trust: 'full', apps: ['fixture-notes'], tools: ['echo', 'delete-note'] })
    expect(r.envFor('fixture-notes')).toEqual({ ELECTRON_RUN_AS_NODE: '1' })
  })

  it('accepts a Claude Desktop style config', () => {
    const w = world()
    const r = w.make()
    expect(r.connectApp({ name: '', command: '{"mcpServers":{"github":{"command":"npx","args":["-y","gh-mcp"]}}}' })).toEqual({ ok: true, id: 'github' })
  })
})

it('parseCommandLine splits like a shell, with quotes', () => {
  expect(parseCommandLine(`npx -y "@scope/server" '/My Folder' a\\ b`)).toEqual(['npx', '-y', '@scope/server', '/My Folder', 'a b'])
})

describe('skill tools', () => {
  it('use_skill returns the instructions; save_skill always asks and saves', async () => {
    const { useSkillTool, saveSkillTool } = await import('../src/main/plugins/skillTools')
    const w = world()
    const r = w.make()
    let saved = 0
    const src = { skills: () => r.skills(), findSkill: (n: string) => r.findSkill(n), saveSkill: (s: never) => r.saveSkill(s), onSaved: () => { saved++ } }
    const save = saveSkillTool(src)
    expect(save.action({} as never, {} as never)).toEqual({ kind: 'app', ask: true })
    expect(save.ask!({ name: 'weekly-report' } as never)).toContain('/weekly-report')
    await save.run({ name: 'weekly-report', description: 'Weekly report', instructions: 'Bullets, then a table.' }, {} as never)
    expect(saved).toBe(1)
    const out = await useSkillTool(src).run({ name: 'weekly-report' }, {} as never)
    expect(out.text).toContain('Bullets, then a table.')
    expect((await useSkillTool(src).run({ name: 'nope' }, {} as never)).failed).toBe(true)
  })
})

describe('review fixes', () => {
  it('app tools ask unless read-only; anything asks after untrusted content', async () => {
    const { mcpTool } = await import('../src/main/plugins/tools')
    const ref = { id: 'n', name: 'Notes', dir: '/x', network: false, env: {} }
    const call = async () => ({ content: [] })
    const ro = mcpTool(ref, { name: 'list', annotations: { readOnlyHint: true } }, call)
    const plain = mcpTool(ref, { name: 'write' }, call)
    const safe = mcpTool(ref, { name: 'tag', annotations: { destructiveHint: false } }, call)
    const ctx = (untrusted: boolean) => ({ untrusted }) as never
    expect(ro.action({}, ctx(false))).toEqual({ kind: 'app', ask: false })
    expect(plain.action({}, ctx(false))).toEqual({ kind: 'app', ask: true })
    expect(safe.action({}, ctx(false))).toEqual({ kind: 'app', ask: false })
    expect(safe.action({}, ctx(true))).toEqual({ kind: 'app', ask: true })
    expect(ro.action({}, ctx(true))).toEqual({ kind: 'app', ask: false })
  })

  it('tools without hints whose names only read (get_, list_, searchIssues…) run without asking', async () => {
    const { mcpTool } = await import('../src/main/plugins/tools')
    const ref = { id: 'n', name: 'Notes', dir: '/x', network: false, env: {} }
    const call = async () => ({ content: [] })
    const ask = (name: string, annotations?: Record<string, boolean>) => mcpTool(ref, { name, ...(annotations ? { annotations } : {}) }, call).action({}, { untrusted: true } as never)
    for (const n of ['ask_wiki_question', 'read_wiki_structure', 'list_issues', 'getIssue', 'search', 'fetch-page']) expect(ask(n)).toEqual({ kind: 'app', ask: false })
    for (const n of ['create_issue', 'delete_note', 'getaway', 'send_email', 'list_and_delete', 'query', 'run_query', 'search_and_replace', 'find_and_drop', 'get_and_apply']) expect(ask(n)).toEqual({ kind: 'app', ask: true })
    // the server's own hints win over the name
    expect(ask('get_and_reset', { readOnlyHint: false })).toEqual({ kind: 'app', ask: true })
  })

  it('install refuses my-skills and folders already inside Hob; connectApp refuses my-skills', () => {
    const w = world()
    const r = w.make()
    r.saveSkill({ name: 'keep', description: 'd', instructions: 'i' })
    const evil = plugin(join(w.root, 'dl'), 'my-skills', {})
    expect(r.install(evil)).toMatchObject({ ok: false })
    expect(r.findSkill('keep')).toBeDefined()
    expect(r.install(join(w.installDir, 'my-skills'))).toMatchObject({ ok: false })
    expect(r.connectApp({ name: 'My skills', command: 'npx x' })).toMatchObject({ ok: false })
  })

  it('a failed install keeps the old version', () => {
    const w = world()
    const r = w.make()
    const src = plugin(join(w.root, 'dl'), 'notes', { description: 'v1' })
    r.install(src)
    expect(r.install(join(w.root, 'nope'))).toMatchObject({ ok: false })
    expect(r.list().find((p) => p.id === 'notes')?.description).toBe('v1')
  })

  it('saveSkill does not overwrite another skill unless editing', () => {
    const w = world()
    const r = w.make()
    r.saveSkill({ name: 'report', description: 'd', instructions: 'one' })
    expect(r.saveSkill({ name: 'Report', description: 'd', instructions: 'two' })).toMatchObject({ ok: false })
    expect(r.saveSkill({ name: 'report', description: 'd', instructions: 'two' }, { replace: true })).toMatchObject({ ok: true })
    expect(r.findSkill('report')?.body).toBe('two')
  })

  it('connectApp keys become secret settings, not plain text in the manifest', () => {
    const w = world()
    const r = w.make()
    expect(r.connectApp({ name: 'Svc', command: 'npx svc', env: 'API_KEY=abc\nBROKEN' })).toEqual({ ok: true, id: 'svc' })
    const raw = readFileSync(join(w.installDir, 'svc', 'hob-plugin.json'), 'utf8')
    expect(raw).not.toContain('abc')
    expect(w.store.pluginSettings('svc').API_KEY).toBe('enc:abc')
    expect(r.envFor('svc')).toEqual({ API_KEY: 'abc' })
  })

  it('prompt lines only for plugins whose tools are offered', () => {
    const w = world()
    plugin(w.builtinDir, 'weather', { tools: [{ native: 'get_weather' }], prompt: 'Use get_weather.' })
    plugin(w.builtinDir, 'tips', { prompt: 'Be kind.' })
    expect(w.make().prompts(['read_file'])).toEqual(['Be kind.'])
    expect(reg!.prompts(['get_weather'])).toEqual(['Be kind.', 'Use get_weather.'])
  })
})

it('sorts what was added into plugins and connectors; your skills are their own kind', () => {
  const w = world()
  plugin(w.installDir, 'notes-server', { mcpServers: { notes: { command: 'node', args: ['x.js'] } } })
  plugin(w.installDir, 'pdf-kit', { mcpServers: { pdf: { command: 'node', args: ['x.js'] } } }, { 'fill-it': '---\nname: fill-it\ndescription: d\n---\nGo.' })
  plugin(w.installDir, 'trip', {}, { 'plan-trip': '---\nname: plan-trip\ndescription: d\n---\nGo.' })
  const r = w.make()
  r.saveSkill({ name: 'mine', description: 'd', instructions: 'i' })
  const kinds = Object.fromEntries(r.list().map((p) => [p.id, p.kind]))
  expect(kinds).toEqual({ 'my-skills': 'skills', 'notes-server': 'connector', 'pdf-kit': 'plugin', trip: 'plugin' })
})
