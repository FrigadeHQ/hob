import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, normalize, sep } from 'node:path'
import type { Manifest, McpServerConfig, McpStdioConfig, PluginSetting, SettingKind } from './manifest'
import { slug } from './skills'

/**
 * MCP Bundles (.mcpb, formerly .dxt): a zip with a manifest.json and a server inside, the format Claude Desktop installs.
 * https://github.com/anthropics/mcpb/blob/main/MANIFEST.md
 */
export const MCPB_MANIFEST = 'manifest.json'

type Raw = Record<string, unknown>
const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** the manifest.json of a bundle, or undefined if the folder doesn't hold one */
export function readMcpb(dir: string): Raw | undefined {
  const f = join(dir, MCPB_MANIFEST)
  if (!existsSync(f)) return undefined
  try {
    const raw = JSON.parse(readFileSync(f, 'utf8')) as unknown
    return isObj(raw) && (raw.manifest_version !== undefined || raw.dxt_version !== undefined) && isObj(raw.server) ? raw : undefined
  } catch { return undefined }
}

const PLATFORM: Record<string, string> = { darwin: 'Mac', win32: 'Windows', linux: 'Linux' }
const KIND: Record<string, SettingKind> = { string: 'text', number: 'number', boolean: 'boolean', directory: 'directory', file: 'file' }

/** the bundle as a Garth plugin; its icon file comes back separately */
export function fromMcpb(raw: Raw, dir: string, platform: string = process.platform): { manifest: Manifest; image?: string } | { error: string } {
  const name = text(raw.name)
  const id = slug(name)
  if (!id) return { error: 'manifest.json: name is missing' }
  const server = raw.server as Raw
  const type = text(server.type) as McpStdioConfig['runtime']
  if (!type || !['node', 'python', 'uv', 'binary'].includes(type)) return { error: `manifest.json: server.type “${text(server.type)}” isn't supported` }
  const platforms = isObj(raw.compatibility) && Array.isArray(raw.compatibility.platforms) ? raw.compatibility.platforms.map(String) : undefined
  if (platforms && !platforms.includes(platform)) return { error: `This bundle only works on ${platforms.map((p) => PLATFORM[p] ?? p).join(' and ')}.` }

  const entry = text(server.entry_point)
  const cfg = isObj(server.mcp_config) ? server.mcp_config : undefined
  const override = cfg && isObj(cfg.platform_overrides) && isObj(cfg.platform_overrides[platform]) ? cfg.platform_overrides[platform] as Raw : {}
  const strings = (v: unknown) => (Array.isArray(v) ? v.map(String) : undefined)
  const env = { ...(isObj(cfg?.env) ? cfg!.env : {}), ...(isObj(override.env) ? override.env : {}) } as Record<string, unknown>
  let command = text(override.command) || text(cfg?.command)
  let args = strings(override.args) ?? strings(cfg?.args)
  if (!command) {
    // no mcp_config: run the entry point the usual way for its type
    if (!entry && type !== 'uv') return { error: 'manifest.json: server.entry_point is missing' }
    if (type === 'node') { command = 'node'; args = [`\${__dirname}/${entry}`] }
    else if (type === 'python') { command = 'python3'; args = [`\${__dirname}/${entry}`] }
    else if (type === 'uv') { command = 'uv'; args = ['run', '--directory', '${__dirname}', ...(entry ? [entry] : [])] }
    else { command = `\${__dirname}/${entry}`; args = [] }
  }
  const mcp: McpServerConfig = {
    command, runtime: type,
    ...(args?.length ? { args } : {}),
    ...(Object.keys(env).length ? { env: Object.fromEntries(Object.entries(env).map(([k, v]) => [k, String(v)])) } : {}),
  }

  const settings: PluginSetting[] = isObj(raw.user_config)
    ? Object.entries(raw.user_config).filter(([k, v]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && isObj(v)).map(([key, v]) => {
      const c = v as Raw
      const kind = KIND[text(c.type)] ?? 'text'
      const def = c.default === undefined ? undefined : Array.isArray(c.default) ? c.default.map(String).join('\n') : String(c.default)
      return {
        key, label: text(c.title) || key, kind,
        ...(text(c.description) ? { help: text(c.description) } : {}),
        ...(c.sensitive === true ? { secret: true } : {}),
        ...(c.required === true ? { required: true } : {}),
        ...(c.multiple === true && (kind === 'directory' || kind === 'file') ? { multiple: true } : {}),
        ...(def !== undefined ? { default: def } : {}),
      }
    })
    : []

  // the biggest PNG up to 256px, else the legacy single icon
  const icons = Array.isArray(raw.icons) ? raw.icons.filter(isObj).map((i) => ({ src: text(i.src), size: Number(text(i.size).split('x')[0]) || 0 })).filter((i) => i.src && !/^https?:/.test(i.src)) : []
  const best = icons.filter((i) => i.size <= 256).sort((a, b) => b.size - a.size)[0] ?? icons[0]
  const iconFile = best?.src || (text(raw.icon) && !/^https?:/.test(text(raw.icon)) ? text(raw.icon) : '')
  const author = isObj(raw.author) ? text(raw.author.name) : ''

  return {
    manifest: {
      id, name: text(raw.display_name) || name, version: text(raw.version) || '0.0.0', description: text(raw.description),
      ...(author ? { author } : {}), icon: 'plug', permissions: { network: false },
      starters: [], tools: [], mcpServers: { [id]: mcp }, settings,
    },
    ...(iconFile ? { image: iconFile } : {}),
  }
}

/** a setting's default with ${HOME}… filled in; folders and files in this system's own form ("${HOME}/Desktop" → C:\Users\me\Desktop) */
export function settingDefault(s: { kind?: string; default?: string }, dir: string): string | undefined {
  if (s.default === undefined) return undefined
  const v = expandConfig({ command: s.default }, standardVars(dir)).command
  return s.kind === 'directory' || s.kind === 'file' ? v.split('\n').map((p) => (p ? normalize(p) : p)).join('\n') : v
}

/** the folders ${HOME}, ${DESKTOP}… stand for */
export function standardVars(dir: string): Record<string, string> {
  const home = homedir()
  return { __dirname: dir, HOME: home, DESKTOP: join(home, 'Desktop'), DOCUMENTS: join(home, 'Documents'), DOWNLOADS: join(home, 'Downloads'), '/': sep, pathSeparator: sep }
}

/**
 * Fill ${name} placeholders in a server config. A list value (several folders) used as a whole argument
 * becomes one argument per item, as Claude Desktop does it.
 */
export function expandConfig<T extends McpServerConfig>(cfg: T, vars: Record<string, string>, lists: Record<string, string[]> = {}): T {
  const one = (s: string) => s.replace(/\$\{([^}]+)\}/g, (m, k: string) => (lists[k] ? lists[k].join(',') : vars[k] ?? (k.startsWith('user_config.') ? '' : m)))
  const map = (o?: Record<string, string>) => (o ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, one(v)])) : undefined)
  const out = { ...cfg } as McpServerConfig
  if ('url' in out) {
    out.url = one(out.url)
    if (out.headers) out.headers = map(out.headers)
  } else {
    out.command = one(out.command)
    if (out.args) out.args = out.args.flatMap((a) => { const m = a.match(/^\$\{([^}]+)\}$/); return m && lists[m[1]] ? lists[m[1]] : [one(a)] })
    if (out.env) out.env = map(out.env)
  }
  return out as T
}
