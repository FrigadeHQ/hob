import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import type { Tool } from '../agent/tool'
import { isInside } from '../workspace'
import type { NewSkill, PluginInfo, PluginResult, PluginSource, PluginTrust, SkillRef, StarterRef } from '../../shared/plugins'
import type { Store } from '../store'
import { isUrlConfig, parseManifest, PLUGIN_ID, type Manifest, type McpServerConfig, type McpUrlConfig } from './manifest'
import { McpAuthError, McpClient, type McpServerSpec, type McpTool } from './mcp'
import { expandConfig, fromMcpb, readMcpb, settingDefault, standardVars } from './mcpb'
import { refreshTokens, signIn as oauthSignIn, tokenFresh, type OAuthState } from './oauth'
import { parseSkill, skillFile, skillNameOk, slug, type Skill } from './skills'
import { mcpTool, pythonTool, safeToolName, type PluginRef } from './tools'

export const MANIFEST = 'hob-plugin.json'
export const MY_SKILLS = 'my-skills'

type Loaded = {
  manifest: Manifest
  dir: string
  source: PluginSource
  skills: Skill[]
  /** picture file inside the plugin folder (an .mcpb bundle's icon) */
  image?: string
  /** couldn't load: listed, always off */
  error?: string
}

export type RegistryDeps = {
  /** plugins that ship with Hob (read-only) */
  builtinDir: string
  /** plugins the user added, one folder each */
  installDir: string
  store: Store
  /** Hob's own tools that built-in plugins may expose, by name */
  native: Record<string, Tool<any>>
  /** names plugin tools must not take (Hob's core tools) */
  reserved: string[]
  /** plugins whose switch is an existing setting (the Web plugin is "Web access") */
  bound?: Record<string, { get(): boolean; set(on: boolean): void }>
  /** secret settings at rest (Electron safeStorage in the app) */
  crypt: { encrypt(s: string): string; decrypt(s: string): string }
  /** PATH for app connections (the user's login shell PATH) */
  path(): Promise<string>
  /** opens the browser for signing in to online app connections */
  openExternal?(url: string): unknown
  /** Hob's own Node (Electron as Node), so bundles made for Node run without installing it */
  node?: { command: string; env: Record<string, string> }
  /** Hob's own Python, for Python bundles */
  python?(): Promise<string>
  onChange?(): void
}

/** zips Hob can add: its own plugins and MCP bundles (.mcpb, and .dxt from before the rename) */
export const PLUGIN_FILES = ['zip', 'mcpb', 'dxt']
const isPluginFile = (p: string) => PLUGIN_FILES.includes(extname(p).slice(1).toLowerCase())
/** a folder Hob can load: a Hob plugin or an MCP bundle */
const hasPlugin = (dir: string) => existsSync(join(dir, MANIFEST)) || !!readMcpb(dir)
const OAUTH = (server: string) => `oauth:${server}`
/** "https://mcp.linear.app/mcp" → "Linear" */
export function nameFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname
    if (host === 'localhost' || /^[\d.]+$|:/.test(host)) return 'Local app'
    const parts = host.split('.').filter((p) => !/^(www|mcp|api|app|server|remote)$/.test(p))
    const n = (parts.length > 1 ? parts.at(-2) : parts[0]) ?? 'App'
    return n.charAt(0).toUpperCase() + n.slice(1)
  } catch { return 'App' }
}

/** "npx -y '@a/b' My\ Folder" → ['npx', '-y', '@a/b', 'My Folder'] */
export function parseCommandLine(s: string): string[] {
  const out: string[] = []
  let cur = ''; let quote = ''; let has = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quote) { if (c === quote) quote = ''; else if (c === '\\' && quote === '"' && i + 1 < s.length) cur += s[++i]; else cur += c; continue }
    if (c === '"' || c === "'") { quote = c; has = true; continue }
    if (c === '\\' && i + 1 < s.length) { cur += s[++i]; has = true; continue }
    if (/\s/.test(c)) { if (has || cur) out.push(cur); cur = ''; has = false; continue }
    cur += c
  }
  if (has || cur) out.push(cur)
  return out
}

const RETRY_MS = 60_000
/** resolves undefined after ms, or when the user presses Stop */
const wait = (ms: number, signal?: AbortSignal) => new Promise<undefined>((r) => { const t = setTimeout(r, ms); signal?.addEventListener('abort', () => { clearTimeout(t); r(undefined) }, { once: true }) })
/** "Weekly report" → "weekly-report"; what the user types after / */
export const skillName = (n: string) => (skillNameOk(n) ? n : slug(n))
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

const broken = (dir: string, source: PluginSource, error: string): Loaded => ({
  manifest: { id: slug(basename(dir)) || 'plugin', name: basename(dir), version: '0.0.0', description: '', icon: 'puzzle', permissions: { network: false }, starters: [], tools: [], mcpServers: {}, settings: [] },
  dir, source, skills: [], error,
})

function load(dir: string, source: PluginSource): Loaded | undefined {
  const file = join(dir, MANIFEST)
  if (!existsSync(file)) {
    const bundle = readMcpb(dir)
    if (!bundle) return undefined
    const r = fromMcpb(bundle, dir)
    if ('error' in r) return broken(dir, source, r.error)
    return { manifest: r.manifest, dir, source, skills: [], ...(r.image ? { image: r.image } : {}) }
  }
  const fallback = (error: string) => broken(dir, source, error)
  let raw: unknown
  try { raw = JSON.parse(readFileSync(file, 'utf8')) } catch (e) { return fallback(`${MANIFEST} isn't valid JSON: ${errText(e)}`) }
  const r = parseManifest(raw, { builtin: source === 'builtin' })
  if ('error' in r) return fallback(r.error)
  for (const t of r.manifest.tools) if (t.run && !existsSync(join(dir, t.run))) return { ...fallback(`${MANIFEST}: ${t.run} is missing`), manifest: r.manifest }
  const skills: Skill[] = []
  const skillsDir = join(dir, 'skills')
  if (existsSync(skillsDir)) {
    for (const n of readdirSync(skillsDir).sort()) {
      const f = join(skillsDir, n, 'SKILL.md')
      if (!existsSync(f)) continue
      const s = parseSkill(readFileSync(f, 'utf8'), join(skillsDir, n))
      if ('error' in s) return { ...fallback(s.error), manifest: r.manifest }
      skills.push(s)
    }
  }
  return { manifest: r.manifest, dir, source, skills }
}

const subdirs = (d: string) => (existsSync(d) ? readdirSync(d).filter((n) => !n.startsWith('.')).map((n) => join(d, n)).filter((p) => { try { return statSync(p).isDirectory() } catch { return false } }) : [])

/** Every plugin Hob knows: what's on, what it adds, and how to add or remove one. */
export class PluginRegistry {
  private plugins: Loaded[] = []
  private clients = new Map<string, Promise<McpClient>>()
  private mcpTools = new Map<string, McpTool[]>()
  private runtimeErrors = new Map<string, string>()
  /** when an app connection last failed: don't make every message wait for it again */
  private failedAt = new Map<string, number>()
  /** online app connections that need the user to sign in: key → the server's WWW-Authenticate */
  private authNeeded = new Map<string, string>()
  private watchers: FSWatcher[] = []
  private reloadTimer: NodeJS.Timeout | undefined

  constructor(private d: RegistryDeps) { this.reload() }

  reload() {
    const seen = new Set<string>()
    const next: Loaded[] = []
    const add = (p: Loaded | undefined) => {
      if (!p || seen.has(p.manifest.id)) return
      seen.add(p.manifest.id)
      next.push(p)
    }
    // the user's own skills win over a built-in one with the same name
    add(load(join(this.d.installDir, MY_SKILLS), 'installed'))
    for (const dir of subdirs(this.d.builtinDir)) add(load(dir, 'builtin'))
    for (const dir of subdirs(this.d.installDir)) add(load(dir, 'installed'))
    // a linked folder that moved or lost its manifest still shows, so it can be removed
    for (const dir of this.d.store.pluginLinks()) add(load(dir, 'linked') ?? broken(dir, 'linked', `${MANIFEST} not found in ${dir}`))
    const order = { builtin: 1, installed: 2, linked: 3 }
    next.sort((a, b) => (a.manifest.id === MY_SKILLS ? -1 : b.manifest.id === MY_SKILLS ? 1 : order[a.source] - order[b.source] || a.manifest.name.localeCompare(b.manifest.name)))
    // app connections of plugins that changed or went away restart with the new config
    for (const [key, c] of this.clients) {
      const [id] = key.split('/')
      const was = this.plugins.find((p) => p.manifest.id === id)
      const now = next.find((p) => p.manifest.id === id)
      if (!now || JSON.stringify(now.manifest.mcpServers) !== JSON.stringify(was?.manifest.mcpServers)) { void c.then((x) => x.close()).catch(() => {}); this.clients.delete(key); this.mcpTools.delete(key) }
    }
    this.plugins = next
    this.watchLinks()
  }

  private watchLinks() {
    for (const w of this.watchers) w.close()
    this.watchers = []
    for (const p of this.plugins) {
      if (p.source !== 'linked' || !existsSync(p.dir)) continue
      try {
        this.watchers.push(watch(p.dir, { recursive: true }, () => {
          clearTimeout(this.reloadTimer)
          this.reloadTimer = setTimeout(() => { this.reload(); this.d.onChange?.() }, 300)
        }))
      } catch { /* watching is a convenience */ }
    }
  }

  private isOn(p: Loaded): boolean {
    if (p.error) return false
    const bound = this.d.bound?.[p.manifest.id]
    if (bound) return bound.get()
    return this.d.store.pluginEnabled(p.manifest.id) ?? true
  }
  private on() { return this.plugins.filter((p) => this.isOn(p)) }
  private get(id: string) { return this.plugins.find((p) => p.manifest.id === id) }

  list(): PluginInfo[] {
    return this.plugins.map((p) => {
      const m = p.manifest
      const stored = this.d.store.pluginSettings(m.id)
      const apps = Object.keys(m.mcpServers)
      const servers = Object.values(m.mcpServers)
      const trust: PluginTrust = servers.some((c) => !isUrlConfig(c)) ? 'full' : servers.length ? 'online' : m.permissions.network ? 'network' : m.tools.length ? 'code' : 'instructions'
      const mcpNames = apps.flatMap((a) => (this.mcpTools.get(`${m.id}/${a}`) ?? []).map((t) => t.name))
      const error = p.error ?? this.runtimeErrors.get(m.id)
      return {
        id: m.id, name: m.name, description: m.description, version: m.version, ...(m.author ? { author: m.author } : {}), icon: m.icon,
        ...(p.image ? this.image(p) : {}),
        source: p.source, enabled: this.isOn(p), ...(error ? { error } : {}), dir: p.dir, trust,
        ...(apps.some((a) => this.authNeeded.has(`${m.id}/${a}`)) ? { signIn: true } : {}),
        ...(apps.some((a) => this.d.store.pluginSettings(m.id)[OAUTH(a)]) ? { signedIn: true } : {}),
        skills: p.skills.map((s) => ({ name: s.name, description: s.description })),
        tools: [...m.tools.map((t) => t.name), ...mcpNames], apps, starters: m.starters,
        settings: m.settings.map((s) => ({
          key: s.key, label: s.label, secret: !!s.secret, ...(s.help ? { help: s.help } : {}), set: stored[s.key] !== undefined,
          ...(!s.secret && stored[s.key] !== undefined ? { value: stored[s.key] } : {}),
          kind: s.kind ?? 'text', required: !!s.required, multiple: !!s.multiple,
          ...(s.default !== undefined ? { default: settingDefault(s, p.dir) } : {}),
        })),
      }
    })
  }

  private image(p: Loaded): { image?: string } {
    const types: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' }
    const f = join(p.dir, p.image!)
    const type = types[extname(f).toLowerCase()]
    try {
      if (!type || !isInside(p.dir, f) || statSync(f).size > 512_000) return {}
      return { image: `data:${type};base64,${readFileSync(f).toString('base64')}` }
    } catch { return {} }
  }

  skills(): (Skill & SkillRef)[] {
    const seen = new Set<string>()
    return this.on().flatMap((p) => p.skills.map((s) => ({ ...s, pluginId: p.manifest.id, pluginName: p.manifest.name, icon: p.manifest.icon })))
      .filter((s) => (seen.has(s.name) ? false : (seen.add(s.name), true)))
  }
  findSkill(name: string) { return this.skills().find((s) => s.name === name) }
  starters(): StarterRef[] { return this.on().flatMap((p) => p.manifest.starters.map((s) => ({ ...s, icon: p.manifest.icon, pluginId: p.manifest.id }))) }
  /** offered: tool names this turn; a plugin whose tools aren't offered (e.g. web is off) adds no instructions */
  prompts(offered?: string[]): string[] {
    return this.on().flatMap((p) => {
      if (!p.manifest.prompt) return []
      const names = p.manifest.tools.map((t) => t.native ?? t.name)
      const live = !offered || !names.length || names.some((n) => offered.some((o) => o === n || o.endsWith(`_${n}`)))
      return live ? [p.manifest.prompt] : []
    })
  }

  /** settings as environment variables for the plugin's code */
  envFor(id: string): Record<string, string> {
    const p = this.get(id)
    if (!p) return {}
    const stored = this.d.store.pluginSettings(id)
    const env: Record<string, string> = {}
    for (const s of p.manifest.settings) {
      const v = stored[s.key]
      if (v === undefined) { if (s.default !== undefined) env[s.key] = settingDefault(s, p.dir)!; continue }
      try { env[s.key] = s.secret ? this.d.crypt.decrypt(v) : v } catch { /* can't decrypt on this computer: treat as unset */ }
    }
    return env
  }

  /** the settings a plugin needs before its app connection can start */
  private missing(p: Loaded): string[] {
    const env = this.envFor(p.manifest.id)
    return p.manifest.settings.filter((s) => s.required && !env[s.key]?.trim()).map((s) => s.label)
  }

  private oauthState(id: string, server: string): OAuthState | undefined {
    const v = this.d.store.pluginSettings(id)[OAUTH(server)]
    if (!v) return undefined
    try { return JSON.parse(this.d.crypt.decrypt(v)) as OAuthState } catch { return undefined }
  }
  private saveOAuth(id: string, server: string, s: OAuthState | undefined) {
    this.d.store.setPluginSetting(id, OAUTH(server), s ? this.d.crypt.encrypt(JSON.stringify(s)) : null)
  }

  /** one refresh at a time per server: servers that rotate refresh tokens treat a second use as theft */
  private refreshing = new Map<string, Promise<boolean>>()
  private refreshOnce(id: string, server: string): Promise<boolean> {
    const key = `${id}/${server}`
    let r = this.refreshing.get(key)
    if (!r) {
      const before = this.oauthState(id, server)
      r = (async () => {
        const next = before && (await refreshTokens(before))
        if (!next) return false
        this.saveOAuth(id, server, next)
        return true
      })().finally(() => this.refreshing.delete(key))
      this.refreshing.set(key, r)
    }
    return r
  }

  /** what the client needs to reach a server: settings filled in, Hob's own Node/Python, the sign-in token */
  private async spec(p: Loaded, server: string, cfg: McpServerConfig): Promise<McpServerSpec> {
    const id = p.manifest.id
    const env = this.envFor(id)
    const lists = Object.fromEntries(p.manifest.settings.filter((s) => s.multiple && env[s.key]).flatMap((s) => {
      const items = env[s.key].split('\n').map((x) => x.trim()).filter(Boolean)
      return [[s.key, items], [`user_config.${s.key}`, items]]
    }))
    const vars = { ...standardVars(p.dir), ...env, ...Object.fromEntries(Object.entries(env).map(([k, v]) => [`user_config.${k}`, v])) }
    const c = expandConfig(cfg, vars, lists)
    if (isUrlConfig(c)) {
      return {
        url: c.url, ...(c.headers ? { headers: c.headers } : {}), ...(c.type === 'sse' ? { transport: 'sse' as const } : {}),
        auth: {
          token: async () => {
            const s = this.oauthState(id, server)
            if (!s || tokenFresh(s) || !s.tokens?.refresh_token) return s?.tokens?.access_token
            await this.refreshOnce(id, server)
            return this.oauthState(id, server)?.tokens?.access_token
          },
          refresh: () => this.refreshOnce(id, server),
        },
      }
    }
    let command = c.command
    let extra: Record<string, string> = {}
    // bundles run on Hob's own runtimes, so the user doesn't have to install Node or Python
    if (c.runtime === 'node' && command === 'node' && this.d.node) { command = this.d.node.command; extra = this.d.node.env }
    if (c.runtime === 'python' && /^python3?$/.test(command) && this.d.python) command = await this.d.python()
    return { command, args: c.args, cwd: p.dir, env: { PATH: await this.d.path(), ...c.env, ...env, ...extra } }
  }

  /**
   * The tools of every plugin that's on, with clashing names made unique.
   * waitMs: how long a message waits for app connections that are still starting (they keep starting in the background).
   */
  async tools(o: { waitMs?: number; signal?: AbortSignal } = {}): Promise<Tool<any>[]> {
    const taken = new Set(this.d.reserved)
    const out: Tool<any>[] = []
    const name = (p: Loaded, n: string) => {
      let final = taken.has(n) ? safeToolName(`${p.manifest.id}_${n}`) : n
      for (let i = 2; taken.has(final); i++) final = `${final}_${i}`
      taken.add(final)
      return final
    }
    for (const p of this.on()) {
      const ref: PluginRef = { id: p.manifest.id, name: p.manifest.name, dir: p.dir, network: p.manifest.permissions.network, env: this.envFor(p.manifest.id) }
      for (const t of p.manifest.tools) {
        if (t.native) {
          const n = this.d.native[t.native]
          if (n) { taken.add(n.spec.name); out.push(n) }
        } else out.push(pythonTool(ref, t, name(p, t.name)))
      }
      const missing = Object.keys(p.manifest.mcpServers).length ? this.missing(p) : []
      if (missing.length) { this.runtimeErrors.set(p.manifest.id, `Fill in ${missing.map((m) => `“${m}”`).join(' and ')} to use it.`); continue }
      for (const [server, cfg] of Object.entries(p.manifest.mcpServers)) {
        const key = `${p.manifest.id}/${server}`
        if (this.authNeeded.has(key) || Date.now() - (this.failedAt.get(key) ?? 0) < RETRY_MS) continue
        try {
          const client = await this.client(p, server, cfg)
          const listing = this.listMcp(key, client)
          listing.catch((e) => this.failed(p.manifest.id, key, e))
          const listed = o.waitMs === undefined ? await listing : await Promise.race([listing, wait(o.waitMs, o.signal)])
          if (!listed) continue // still starting: available from a later message
          this.failedAt.delete(key)
          this.runtimeErrors.delete(p.manifest.id)
          const id = p.manifest.id
          // a sign-in that stopped working shows Sign in on the card again
          const call = (n: string, a: unknown, s: AbortSignal) => client.call(n, a, s).catch((e) => {
            if (e instanceof McpAuthError) { this.failed(id, key, e); this.dropClient(key) }
            throw e
          })
          for (const t of listed) out.push(mcpTool(ref, t, call, name(p, safeToolName(t.name))))
        } catch { /* recorded above */ }
      }
    }
    return out
  }

  private dropClient(key: string) {
    const c = this.clients.get(key)
    this.clients.delete(key)
    this.mcpTools.delete(key)
    void c?.then((x) => x.close()).catch(() => {})
  }

  private failed(id: string, key: string, e: unknown) {
    this.failedAt.set(key, Date.now())
    if (e instanceof McpAuthError) {
      this.authNeeded.set(key, e.wwwAuthenticate)
      this.runtimeErrors.set(id, 'Sign in to use it.')
    } else this.runtimeErrors.set(id, `Couldn't connect: ${errText(e)}`)
    this.d.onChange?.()
  }

  /** one client per server, even when two messages ask at once (the promise is stored before any wait) */
  private client(p: Loaded, server: string, cfg: McpServerConfig): Promise<McpClient> {
    const key = `${p.manifest.id}/${server}`
    let c = this.clients.get(key)
    if (!c) {
      c = this.spec(p, server, cfg).then((spec) => new McpClient(spec))
      c.catch(() => this.clients.delete(key))
      this.clients.set(key, c)
    }
    return c
  }

  /**
   * Connect a plugin's app connections now, signing in where a server asks for it (opens the browser).
   * Used right after the user adds a connection, and by the Sign in button.
   */
  async connect(id: string, signal?: AbortSignal): Promise<PluginResult> {
    const p = this.get(id)
    if (!p) return { ok: false, error: 'That plugin is gone.' }
    if (p.error) return { ok: false, error: p.error }
    const missing = this.missing(p)
    if (missing.length) return { ok: false, error: `Fill in ${missing.map((m) => `“${m}”`).join(' and ')} first.` }
    for (const [server, cfg] of Object.entries(p.manifest.mcpServers)) {
      const key = `${id}/${server}`
      // really ask the server, not the tools remembered from before
      this.mcpTools.delete(key)
      const list = async () => this.listMcp(key, await this.client(p, server, cfg))
      try {
        try {
          await list()
        } catch (e) {
          if (!(e instanceof McpAuthError) || !isUrlConfig(cfg)) throw e
          await this.signIn(id, server, cfg, e.wwwAuthenticate, signal)
          await list()
        }
        this.failedAt.delete(key)
        this.authNeeded.delete(key)
        this.runtimeErrors.delete(id)
      } catch (e) {
        this.failed(id, key, e)
        return { ok: false, error: e instanceof McpAuthError ? 'Sign in to use it.' : errText(e) }
      } finally {
        this.d.onChange?.()
      }
    }
    return { ok: true, id }
  }

  private async signIn(id: string, server: string, cfg: McpUrlConfig, wwwAuthenticate: string | undefined, signal?: AbortSignal) {
    if (!this.d.openExternal) throw new Error("Hob can't open a browser to sign in.")
    const key = `${id}/${server}`
    const p = this.get(id)!
    const url = (await this.spec(p, server, cfg) as { url: string }).url
    const s = await oauthSignIn({
      serverUrl: url, wwwAuthenticate, saved: this.oauthState(id, server),
      ...(cfg.oauth ? { clientId: cfg.oauth.clientId, clientSecret: cfg.oauth.clientSecret } : {}),
      open: this.d.openExternal, signal,
    })
    this.saveOAuth(id, server, s)
    this.authNeeded.delete(key)
    this.failedAt.delete(key)
    // reconnect with the new token
    this.dropClient(key)
  }

  /** forget the sign-in of a plugin's online app connections */
  signOut(id: string) {
    const p = this.get(id)
    if (!p) return
    for (const server of Object.keys(p.manifest.mcpServers)) this.saveOAuth(id, server, undefined)
    this.stopClients(id)
  }
  /** one listing per client: a client that was replaced (new settings, sign-in) never answers for the new one */
  private listing = new WeakMap<McpClient, Promise<McpTool[]>>()
  private listMcp(key: string, c: McpClient): Promise<McpTool[]> {
    const cached = this.mcpTools.get(key)
    if (cached) return Promise.resolve(cached)
    let l = this.listing.get(c)
    if (!l) {
      l = c.listTools().then((tools) => {
        // only the current client's tools are kept
        if (this.clients.has(key)) void this.clients.get(key)!.then((now) => { if (now === c) this.mcpTools.set(key, tools) })
        return tools
      }).finally(() => this.listing.delete(c))
      this.listing.set(c, l)
    }
    return l
  }
  /** start app connections in the background so the first message doesn't wait */
  warmUp() { void this.tools().then(() => this.d.onChange?.()).catch(() => {}) }

  setEnabled(id: string, on: boolean) {
    const bound = this.d.bound?.[id]
    if (bound) bound.set(on)
    else this.d.store.setPluginEnabled(id, on)
    if (!on) this.stopClients(id)
  }
  setSetting(id: string, key: string, value: string) {
    const s = this.get(id)?.manifest.settings.find((x) => x.key === key)
    if (!s) return
    this.d.store.setPluginSetting(id, key, value === '' ? null : s.secret ? this.d.crypt.encrypt(value) : value)
    // app connections get settings when they start
    this.stopClients(id)
  }
  private stopClients(id: string) {
    for (const [key, c] of this.clients) if (key.startsWith(`${id}/`)) { void c.then((x) => x.close()).catch(() => {}); this.clients.delete(key); this.mcpTools.delete(key) }
    for (const m of [this.failedAt, this.authNeeded]) for (const key of [...m.keys()]) if (key.startsWith(`${id}/`)) m.delete(key)
    this.runtimeErrors.delete(id)
  }

  /** a plugin folder, .zip or .mcpb opened for a look; the unzipped copy is removed after */
  private opened<T>(path: string, f: (src: string) => T): T {
    let src = path
    let tmp: string | undefined
    try {
      if (isPluginFile(path)) {
        tmp = mkdtempSync(join(tmpdir(), 'hob-plugin-'))
        if (process.platform === 'darwin') execFileSync('/usr/bin/ditto', ['-x', '-k', path, tmp])
        // Windows' own tar reads zips; another tar earlier on the PATH (Git's) may not
        else if (process.platform === 'win32') execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', path, '-C', tmp])
        else execFileSync('unzip', ['-q', path, '-d', tmp])
        // zips usually hold one folder
        src = hasPlugin(tmp) ? tmp : subdirs(tmp).find(hasPlugin) ?? tmp
      }
      return f(src)
    } finally {
      if (tmp) rmSync(tmp, { recursive: true, force: true })
    }
  }

  /** what a plugin file is before adding it, so Hob can warn about ones that run their own programs */
  inspect(path: string): { ok: true; name: string; trust: PluginTrust } | { ok: false; error: string } {
    try {
      return this.opened(path, (src) => {
        const p = load(src, 'installed')
        if (!p) return { ok: false as const, error: `That isn't a Hob plugin or MCP bundle: there's no ${MANIFEST} in it.` }
        if (p.error) return { ok: false as const, error: p.error }
        const servers = Object.values(p.manifest.mcpServers)
        const trust: PluginTrust = servers.some((c) => !isUrlConfig(c)) ? 'full' : servers.length ? 'online' : 'code'
        return { ok: true as const, name: p.manifest.name, trust }
      })
    } catch (e) { return { ok: false, error: `Couldn't open that file: ${errText(e)}` } }
  }

  /** copy a plugin folder (or a .zip / .mcpb of one) into Hob; replaces an older copy */
  install(path: string): { ok: true; id: string } | { ok: false; error: string } {
    try {
      return this.opened(path, (src) => this.installFrom(src))
    } catch (e) {
      return { ok: false, error: `Couldn't add that plugin: ${errText(e)}` }
    }
  }

  private installFrom(src: string): { ok: true; id: string } | { ok: false; error: string } {
    {
      if (existsSync(src) && isInside(realpathSync(this.d.installDir), realpathSync(src))) return { ok: false, error: 'That plugin is already added.' }
      const p = load(src, 'installed')
      if (!p) return { ok: false, error: `That isn't a Hob plugin or MCP bundle: there's no ${MANIFEST} in it.` }
      if (p.error) return { ok: false, error: p.error }
      const id = p.manifest.id
      if (id === MY_SKILLS) return { ok: false, error: `The id “${MY_SKILLS}” is reserved for your own skills.` }
      const existing = this.get(id)
      if (existing?.source === 'builtin') return { ok: false, error: `“${p.manifest.name}” comes with Hob already.` }
      if (existing?.source === 'linked') return { ok: false, error: `“${p.manifest.name}” is linked from a folder. Unlink it first.` }
      // copy next to the old version, then swap: a failed copy never loses what was installed
      const dest = join(this.d.installDir, id)
      const staging = join(this.d.installDir, `.incoming-${id}-${Date.now()}`)
      cpSync(src, staging, { recursive: true, filter: (f) => !/[\\/](\.git|node_modules\/\.cache)([\\/]|$)/.test(f) })
      const old = join(this.d.installDir, `.old-${id}-${Date.now()}`)
      if (existsSync(dest)) renameSync(dest, old)
      renameSync(staging, dest)
      rmSync(old, { recursive: true, force: true })
      this.stopClients(id)
      this.reload()
      return { ok: true, id }
    }
  }

  /** use a developer's folder in place; it reloads when its files change */
  link(dir: string): { ok: true; id: string } | { ok: false; error: string } {
    const p = load(dir, 'linked')
    if (!p) return { ok: false, error: `There's no ${MANIFEST} (or MCP bundle manifest.json) in that folder.` }
    if (p.error) return { ok: false, error: p.error }
    if (this.get(p.manifest.id) && this.get(p.manifest.id)!.dir !== dir) return { ok: false, error: `A plugin with the id “${p.manifest.id}” is already added.` }
    this.d.store.addPluginLink(dir)
    this.reload()
    return { ok: true, id: p.manifest.id }
  }

  remove(id: string) {
    const p = this.get(id)
    if (!p || p.source === 'builtin') return
    this.stopClients(id)
    if (p.source === 'linked') this.d.store.removePluginLink(p.dir)
    else rmSync(p.dir, { recursive: true, force: true })
    this.d.store.forgetPlugin(id)
    this.reload()
  }

  /** a skill the user (or Hob, with the user's OK) wrote; saved in "My skills" */
  saveSkill(s: NewSkill, o: { replace?: boolean } = {}): { ok: true; id: string; name: string } | { ok: false; error: string } {
    const name = skillName(s.name)
    if (!name) return { ok: false, error: 'Give the skill a name with letters or numbers.' }
    if (!o.replace && this.findSkill(name)) return { ok: false, error: `There's already a skill called /${name}. Pick another name.` }
    if (!s.description.trim()) return { ok: false, error: 'Say when Hob should use this skill.' }
    if (!s.instructions.trim()) return { ok: false, error: 'Write the instructions for this skill.' }
    const dir = join(this.d.installDir, MY_SKILLS)
    if (!existsSync(join(dir, MANIFEST))) {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, MANIFEST), JSON.stringify({ id: MY_SKILLS, name: 'My skills', description: 'Skills you taught Hob.', icon: 'sparkles', version: '1.0.0' }, null, 2))
    }
    mkdirSync(join(dir, 'skills', name), { recursive: true })
    writeFileSync(join(dir, 'skills', name, 'SKILL.md'), skillFile({ name, description: s.description, instructions: s.instructions }))
    this.reload()
    return { ok: true, id: MY_SKILLS, name }
  }
  removeSkill(name: string) {
    const dir = join(this.d.installDir, MY_SKILLS, 'skills', name)
    if (skillNameOk(name) && existsSync(dir)) { rmSync(dir, { recursive: true, force: true }); this.reload() }
  }

  /**
   * An MCP server from a URL ("https://mcp.example.com/mcp"), a command line ("npx -y some-server"),
   * or a Claude / Cursor / VS Code style {"mcpServers": …} config.
   * env: KEY=value lines for commands; "Header: value" lines for URLs. Both are stored as secret settings.
   */
  connectApp(o: { name: string; command: string; env?: string }): { ok: true; id: string } | { ok: false; error: string } {
    const text = o.command.trim()
    let servers: Record<string, McpServerConfig>
    let secrets: Record<string, string> = {}
    const labels: Record<string, string> = {}
    let name = o.name.trim()
    const lines = (o.env ?? '').split('\n').map((l) => l.trim()).filter(Boolean)
    if (/^https?:\/\//i.test(text)) {
      let url: URL
      try { url = new URL(text) } catch { return { ok: false, error: "That link doesn't look right." } }
      name ||= nameFromUrl(text)
      // headers ("Authorization: Bearer abc") are kept as secret settings and filled in when connecting
      const headers: Record<string, string> = {}
      for (const l of lines) {
        const i = l.search(/[:=]/)
        if (i <= 0) continue
        const header = l.slice(0, i).trim()
        const key = `HEADER_${header.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`.slice(0, 64)
        headers[header] = `\${${key}}`
        secrets[key] = l.slice(i + 1).trim()
        labels[key] = header
      }
      servers = { [slug(name) || 'app']: { url: url.toString(), ...(Object.keys(headers).length ? { headers } : {}) } }
    } else if (text.startsWith('{')) {
      let j: { mcpServers?: Record<string, McpServerConfig>; servers?: Record<string, McpServerConfig> }
      try { j = JSON.parse(text) } catch { return { ok: false, error: "That config isn't valid JSON." } }
      servers = j.mcpServers ?? j.servers ?? (j as Record<string, McpServerConfig>)
      if (!Object.keys(servers).length) return { ok: false, error: 'No servers found in that config.' }
      name ||= Object.keys(servers)[0]
    } else {
      const [command, ...args] = parseCommandLine(text)
      if (!command) return { ok: false, error: 'Enter the command that starts the app connection.' }
      secrets = Object.fromEntries(lines.filter((l) => l.indexOf('=') > 0).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
      name ||= basename(args.at(-1) ?? command)
      servers = { [slug(name) || 'app']: { command, args } }
    }
    const id = slug(name)
    if (!PLUGIN_ID.test(id)) return { ok: false, error: 'Give the connection a name with letters or numbers.' }
    if (id === MY_SKILLS || this.get(id)) return { ok: false, error: `“${name}” is already added.` }
    // keys typed in the form are stored like any secret setting, never in plain text in the plugin folder
    const keys = Object.entries(secrets)
    const online = Object.values(servers).every((c) => c && typeof c === 'object' && ('url' in c || (c as { type?: string }).type === 'http'))
    const description = online ? `Online app connection: ${Object.values(servers).map((c) => { try { return new URL((c as McpUrlConfig).url).host } catch { return '' } }).filter(Boolean).join(', ')}` : 'App connection (MCP).'
    const manifest = { id, name, version: '1.0.0', description, icon: online ? 'globe' : 'plug', mcpServers: servers, ...(keys.length ? { settings: keys.map(([key]) => ({ key, label: labels[key] ?? key, secret: true })) } : {}) }
    const r = parseManifest(manifest)
    if ('error' in r) return { ok: false, error: r.error }
    const dir = join(this.d.installDir, id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, MANIFEST), JSON.stringify(manifest, null, 2))
    this.reload()
    for (const [k, v] of keys) this.setSetting(id, k, v)
    return { ok: true, id }
  }

  close() {
    for (const w of this.watchers) w.close()
    clearTimeout(this.reloadTimer)
    for (const c of this.clients.values()) void c.then((x) => x.close()).catch(() => {})
    this.clients.clear()
  }
}
