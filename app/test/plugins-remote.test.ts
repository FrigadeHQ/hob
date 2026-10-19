import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { expandConfig, fromMcpb } from '../src/main/plugins/mcpb'
import { nameFromUrl, PluginRegistry } from '../src/main/plugins/registry'
import { Store } from '../src/main/store'
import { startHttpFixture } from './fixtures/mcp-http-server'

const fixture = join(import.meta.dirname, 'fixtures/mcp-server.mjs')
let reg: PluginRegistry | undefined
let fx: Awaited<ReturnType<typeof startHttpFixture>> | undefined
afterEach(async () => { reg?.close(); await fx?.close(); reg = undefined; fx = undefined })

/** follows the sign-in page's redirect back to Hob, like the user's browser would */
const browser = (opened: string[]) => async (url: string) => {
  opened.push(url)
  const r = await fetch(url, { redirect: 'manual' })
  const back = r.headers.get('location')
  if (back) await fetch(back)
}

function world() {
  const root = mkdtempSync(join(tmpdir(), 'hob-remote-'))
  const builtinDir = join(root, 'builtin'); const installDir = join(root, 'installed')
  mkdirSync(builtinDir); mkdirSync(installDir)
  const store = new Store(':memory:')
  const opened: string[] = []
  reg = new PluginRegistry({
    builtinDir, installDir, store, native: {}, reserved: [],
    crypt: { encrypt: (s) => `enc:${s}`, decrypt: (s) => s.replace(/^enc:/, '') },
    path: async () => process.env.PATH ?? '',
    openExternal: browser(opened),
    node: { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } },
  })
  return { root, installDir, store, opened, r: reg }
}

const BUNDLE = {
  manifest_version: '0.3', name: 'notes-bundle', display_name: 'Notes Bundle', version: '1.2.0', description: 'Notes from a bundle.',
  author: { name: 'Ada' }, icon: 'icon.png',
  server: { type: 'node', entry_point: 'server/index.mjs', mcp_config: { command: 'node', args: ['${__dirname}/server/index.mjs', '${user_config.folders}'], env: { FIXTURE_KEY: '${user_config.api_key}' } } },
  user_config: {
    api_key: { type: 'string', title: 'API key', description: 'From your account page', sensitive: true, required: true },
    folders: { type: 'directory', title: 'Folders', multiple: true, default: ['${HOME}/Desktop'] },
    verbose: { type: 'boolean', title: 'Verbose', default: false },
  },
  compatibility: { platforms: ['darwin', 'linux', 'win32'] },
}

function bundle(root: string, manifest: Record<string, unknown> = BUNDLE) {
  const dir = join(root, 'src-bundle')
  mkdirSync(join(dir, 'server'), { recursive: true })
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest))
  copyFileSync(fixture, join(dir, 'server/index.mjs'))
  writeFileSync(join(dir, 'icon.png'), Buffer.from('89504e470d0a1a0a', 'hex'))
  const file = join(root, 'notes.mcpb')
  execFileSync('zip', ['-qr', file, '.'], { cwd: dir })
  return file
}

describe('MCP bundles (.mcpb)', () => {
  it('maps a bundle manifest to a plugin: settings, defaults, platform overrides, runtime', () => {
    const r = fromMcpb({ ...BUNDLE, server: { ...BUNDLE.server, mcp_config: { ...BUNDLE.server.mcp_config, platform_overrides: { darwin: { env: { MAC: '1' } } } } } }, '/b', 'darwin')
    if ('error' in r) throw new Error(r.error)
    expect(r.manifest).toMatchObject({ id: 'notes-bundle', name: 'Notes Bundle', version: '1.2.0', author: 'Ada' })
    expect(r.manifest.mcpServers['notes-bundle']).toEqual({ command: 'node', runtime: 'node', args: ['${__dirname}/server/index.mjs', '${user_config.folders}'], env: { FIXTURE_KEY: '${user_config.api_key}', MAC: '1' } })
    expect(r.manifest.settings).toEqual([
      { key: 'api_key', label: 'API key', kind: 'text', help: 'From your account page', secret: true, required: true },
      { key: 'folders', label: 'Folders', kind: 'directory', multiple: true, default: '${HOME}/Desktop' },
      { key: 'verbose', label: 'Verbose', kind: 'boolean', default: 'false' },
    ])
    expect(r.image).toBe('icon.png')
  })

  it('refuses a bundle made for another system, in plain words', () => {
    expect(fromMcpb({ ...BUNDLE, compatibility: { platforms: ['win32'] } }, '/b', 'darwin')).toEqual({ error: 'This bundle only works on Windows.' })
  })

  it('runs entry points the usual way when there is no mcp_config', () => {
    const r = fromMcpb({ ...BUNDLE, server: { type: 'uv', entry_point: 'main.py' } }, '/b')
    if ('error' in r) throw new Error(r.error)
    expect(r.manifest.mcpServers['notes-bundle']).toMatchObject({ command: 'uv', args: ['run', '--directory', '${__dirname}', 'main.py'] })
  })

  it('fills placeholders; several folders become several arguments', () => {
    const c = expandConfig({ command: '${__dirname}/bin', args: ['--dirs', '${user_config.folders}', 'x=${user_config.missing}', '${user_config.k}'], env: { K: '${user_config.k}', U: '${UNKNOWN}' } },
      { __dirname: '/b', 'user_config.k': 'v' }, { 'user_config.folders': ['/a', '/c'] })
    expect(c).toEqual({ command: '/b/bin', args: ['--dirs', '/a', '/c', 'x=', 'v'], env: { K: 'v', U: '${UNKNOWN}' } })
  })

  it('installs a .mcpb, waits for required settings, then runs on Hob’s own Node with them', async () => {
    const w = world()
    expect(w.r.install(bundle(w.root))).toEqual({ ok: true, id: 'notes-bundle' })
    const info = w.r.list().find((p) => p.id === 'notes-bundle')!
    expect(info).toMatchObject({ name: 'Notes Bundle', trust: 'full', enabled: true, image: expect.stringMatching(/^data:image\/png;base64,/) })
    expect(info.settings.find((s) => s.key === 'folders')).toMatchObject({ kind: 'directory', multiple: true, default: join(homedir(), 'Desktop') })
    // the API key is required: no connection until it's filled in
    expect(await w.r.tools()).toEqual([])
    expect(w.r.list().find((p) => p.id === 'notes-bundle')!.error).toBe('Fill in “API key” to use it.')
    expect(await w.r.connect('notes-bundle')).toEqual({ ok: false, error: 'Fill in “API key” first.' })
    w.r.setSetting('notes-bundle', 'api_key', 'k-42')
    expect(w.store.pluginSettings('notes-bundle').api_key).toBe('enc:k-42')
    expect(await w.r.connect('notes-bundle')).toEqual({ ok: true, id: 'notes-bundle' })
    const echo = (await w.r.tools()).find((t) => t.spec.name === 'echo')!
    const r = await echo.run({ text: 'hi' }, { signal: new AbortController().signal, chatDir: w.root } as never)
    expect(r.text).toMatch(/^echo: hi k-42\n/)
  })

  it('tells what a file is before adding it', () => {
    const w = world()
    expect(w.r.inspect(bundle(w.root))).toEqual({ ok: true, name: 'Notes Bundle', trust: 'full' })
    expect(w.r.inspect(join(w.root, 'nothing.mcpb'))).toMatchObject({ ok: false })
  })
})

describe('online app connections', () => {
  it('names a connection from its link', () => {
    expect(nameFromUrl('https://mcp.linear.app/mcp')).toBe('Linear')
    expect(nameFromUrl('https://api.githubcopilot.com/mcp/')).toBe('Githubcopilot')
    expect(nameFromUrl('https://example.com/sse')).toBe('Example')
  })

  it('connects by URL without sign-in', async () => {
    fx = await startHttpFixture()
    const w = world()
    expect(w.r.connectApp({ name: '', command: fx.url })).toEqual({ ok: true, id: 'local-app' })
    expect(w.r.list().find((p) => p.id === 'local-app')).toMatchObject({ name: 'Local app', trust: 'online', icon: 'globe' })
    expect(await w.r.connect('local-app')).toEqual({ ok: true, id: 'local-app' })
    expect((await w.r.tools()).map((t) => t.spec.name)).toEqual(['echo'])
    expect(w.opened).toEqual([])
  })

  it('header lines become secret settings sent as headers', async () => {
    fx = await startHttpFixture({ auth: true, apiKeys: ['k-9'] })
    const w = world()
    expect(w.r.connectApp({ name: 'Svc', command: fx.url, env: 'Authorization: Bearer k-9' })).toEqual({ ok: true, id: 'svc' })
    const raw = readFileSync(join(w.installDir, 'svc', 'hob-plugin.json'), 'utf8')
    expect(raw).not.toContain('k-9')
    expect(w.r.list().find((p) => p.id === 'svc')!.settings[0]).toMatchObject({ label: 'Authorization', secret: true, set: true })
    expect(await w.r.connect('svc')).toEqual({ ok: true, id: 'svc' })
    expect(fx.state.seenHeaders.at(-1)!.authorization).toBe('Bearer k-9')
  })

  it('a server that needs sign-in: a message skips it and the card asks to sign in; connect() signs in via the browser', async () => {
    fx = await startHttpFixture({ auth: true })
    const w = world()
    w.r.connectApp({ name: 'Linear', command: fx.url })
    expect(await w.r.tools()).toEqual([])
    expect(w.r.list().find((p) => p.id === 'linear')).toMatchObject({ signIn: true, error: 'Sign in to use it.' })
    expect(w.opened).toEqual([]) // a message never opens the browser by itself
    expect(await w.r.connect('linear')).toEqual({ ok: true, id: 'linear' })
    expect(w.opened).toHaveLength(1)
    const info = w.r.list().find((p) => p.id === 'linear')!
    expect(info.signIn).toBeUndefined()
    expect(info.error).toBeUndefined()
    // the token is stored encrypted, and used
    expect(w.store.pluginSettings('linear')['oauth:linear']).toMatch(/^enc:/)
    expect((await w.r.tools()).map((t) => t.spec.name)).toEqual(['echo'])
    expect(fx.state.seenHeaders.at(-1)!.authorization).toMatch(/^Bearer access-/)
  })

  it('an expired token is refreshed without asking the user', async () => {
    fx = await startHttpFixture({ auth: true })
    const w = world()
    w.r.connectApp({ name: 'Linear', command: fx.url })
    await w.r.connect('linear')
    fx.state.tokens.clear() // the server forgets the access token; the refresh token still works
    reg!.close()
    reg = new PluginRegistry({ builtinDir: join(w.root, 'builtin'), installDir: w.installDir, store: w.store, native: {}, reserved: [], crypt: { encrypt: (s) => `enc:${s}`, decrypt: (s) => s.replace(/^enc:/, '') }, path: async () => '', openExternal: browser(w.opened) })
    expect((await reg.tools()).map((t) => t.spec.name)).toEqual(['echo'])
    expect(w.opened).toHaveLength(1)
    expect(fx.state.tokenRequests.at(-1)!.get('grant_type')).toBe('refresh_token')
  })

  it('accepts Claude Code / VS Code style configs with a URL', () => {
    const w = world()
    expect(w.r.connectApp({ name: '', command: '{"servers":{"docs":{"type":"http","url":"https://mcp.example.com/mcp"}}}' })).toEqual({ ok: true, id: 'docs' })
    expect(w.r.list().find((p) => p.id === 'docs')).toMatchObject({ trust: 'online' })
    expect(w.r.connectApp({ name: 'x', command: '{"mcpServers":{"a":{"type":"http","url":"ftp://nope"}}}' })).toMatchObject({ ok: false, error: expect.stringContaining('https://') })
  })
})

it('changing a setting while the app connection is starting connects with the new setting', async () => {
  const w = world()
  w.r.install(bundle(w.root))
  w.r.setSetting('notes-bundle', 'api_key', 'old')
  w.r.warmUp() // starts connecting with the old key
  w.r.setSetting('notes-bundle', 'api_key', 'new')
  expect(await w.r.connect('notes-bundle')).toEqual({ ok: true, id: 'notes-bundle' })
  const echo = (await w.r.tools()).find((t) => t.spec.name === 'echo')!
  expect((await echo.run({ text: 'x' }, { signal: new AbortController().signal, chatDir: w.root } as never)).text).toMatch(/^echo: x new/)
})

it('a sign-in that stops working during a call shows Sign in again, and connect() really reconnects', async () => {
  fx = await startHttpFixture({ auth: true })
  const w = world()
  w.r.connectApp({ name: 'Linear', command: fx.url })
  await w.r.connect('linear')
  const echo = (await w.r.tools()).find((t) => t.spec.name === 'echo')!
  // the token is revoked and can't be refreshed
  fx.state.tokens.clear()
  w.store.setPluginSetting('linear', 'oauth:linear', `enc:${JSON.stringify({ ...JSON.parse(w.store.pluginSettings('linear')['oauth:linear'].slice(4)), tokens: { access_token: 'dead' } })}`)
  await expect(echo.run({ text: 'x' }, { signal: new AbortController().signal, chatDir: w.root } as never)).rejects.toThrow(/sign in/i)
  expect(w.r.list().find((p) => p.id === 'linear')).toMatchObject({ signIn: true })
  expect(await w.r.connect('linear')).toEqual({ ok: true, id: 'linear' })
  expect(w.opened).toHaveLength(2)
  expect(w.r.list().find((p) => p.id === 'linear')!.signIn).toBeUndefined()
})

it('two requests needing a refresh at once share one refresh', async () => {
  fx = await startHttpFixture({ auth: true })
  const w = world()
  w.r.connectApp({ name: 'Linear', command: fx.url })
  await w.r.connect('linear')
  const echo = (await w.r.tools()).find((t) => t.spec.name === 'echo')!
  fx.state.tokens.clear()
  const before = fx.state.tokenRequests.length
  const ctx = { signal: new AbortController().signal, chatDir: w.root } as never
  await Promise.all([echo.run({ text: 'a' }, ctx), echo.run({ text: 'b' }, ctx)])
  expect(fx.state.tokenRequests.slice(before).filter((p) => p.get('grant_type') === 'refresh_token')).toHaveLength(1)
})
