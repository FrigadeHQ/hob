import { isAbsolute, normalize } from 'node:path'

/** A tool a plugin adds: a Python script (any plugin) or Hob's own code (built-in plugins only). */
export type ManifestTool = {
  name: string
  description: string
  params: Record<string, unknown>
  /** Python script, relative to the plugin folder */
  run?: string
  /** built-in plugins only: one of Hob's own tools, by name */
  native?: string
  /** step title, with {arg} placeholders */
  title?: string
}
/** a program on this computer (runtime: how an .mcpb bundle runs it, so Hob can use its own Node or Python) */
export type McpStdioConfig = { command: string; args?: string[]; env?: Record<string, string>; runtime?: 'node' | 'python' | 'uv' | 'binary' }
/** a server on the internet; oauth.clientId when its maker hands out client ids instead of letting apps register */
export type McpUrlConfig = { url: string; type?: 'http' | 'sse'; headers?: Record<string, string>; oauth?: { clientId: string; clientSecret?: string } }
export type McpServerConfig = McpStdioConfig | McpUrlConfig
export const isUrlConfig = (c: McpServerConfig): c is McpUrlConfig => 'url' in c
export type SettingKind = 'text' | 'number' | 'boolean' | 'directory' | 'file'
export type PluginSetting = { key: string; label: string; secret?: boolean; help?: string; kind?: SettingKind; required?: boolean; multiple?: boolean; default?: string }
export type Starter = { title: string; prompt: string }
export type Manifest = {
  id: string
  name: string
  version: string
  description: string
  author?: string
  icon: string
  permissions: { network: boolean }
  starters: Starter[]
  tools: ManifestTool[]
  mcpServers: Record<string, McpServerConfig>
  settings: PluginSetting[]
  /** a line added to Hob's instructions while the plugin is on, e.g. "For PDFs, use read_pdf." */
  prompt?: string
  /** only on these systems (process.platform names, e.g. ["darwin"]); everywhere when left out */
  platforms?: string[]
}

export const PLUGIN_ID = /^[a-z0-9][a-z0-9-]{0,47}$/
export const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
const SETTING_KEY = /^[A-Z][A-Z0-9_]{0,63}$/
const KINDS: SettingKind[] = ['text', 'number', 'boolean', 'directory', 'file']

class Bad extends Error {}
function fail(msg: string): never { throw new Bad(`hob-plugin.json: ${msg}`) }
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown, field: string, required = true): string => {
  if (v === undefined && !required) return ''
  if (typeof v !== 'string' || (required && !v.trim())) fail(`${field} must be text`)
  return (v as string).trim()
}
const list = (v: unknown, field: string): unknown[] => {
  if (v === undefined) return []
  if (!Array.isArray(v)) fail(`${field} must be a list`)
  return v as unknown[]
}
/** a path inside the plugin folder */
const inside = (p: string, field: string) => {
  if (isAbsolute(p) || normalize(p).split(/[\\/]/)[0] === '..') fail(`${field} must be a path inside the plugin folder`)
  return p
}

/** Check a plugin's hob-plugin.json and fill in defaults. Errors are written for the plugin's author. */
export function parseManifest(raw: unknown, opts: { builtin?: boolean } = {}): { manifest: Manifest } | { error: string } {
  try {
    if (!isObj(raw)) fail('must be a JSON object')
    const r = raw as Record<string, unknown>
    const id = str(r.id, 'id')
    if (!PLUGIN_ID.test(id)) fail('id must be lowercase letters, digits and dashes, like "trip-planner"')
    const tools = list(r.tools, 'tools').map((t, i): ManifestTool => {
      const f = `tools[${i}]`
      if (!isObj(t)) fail(`${f} must be an object`)
      const native = t.native === undefined ? undefined : str(t.native, `${f}.native`)
      if (native && !opts.builtin) fail(`${f}.native is only for plugins that ship with Hob; use "run" with a Python script`)
      // Hob's own tools bring their name, description and parameters
      const name = native && t.name === undefined ? native : str(t.name, `${f}.name`)
      if (!TOOL_NAME.test(name)) fail(`${f}.name must be letters, digits or _, starting with a letter`)
      const params = t.params === undefined ? { type: 'object', properties: {} } : t.params
      if (!isObj(params)) fail(`${f}.params must be a JSON schema object`)
      const run = t.run === undefined ? undefined : inside(str(t.run, `${f}.run`), `${f}.run`)
      if (!run && !native) fail(`${f}.run must name the Python script that runs this tool`)
      return { name, description: str(t.description, `${f}.description`, !native), params: params as Record<string, unknown>, ...(run ? { run } : {}), ...(native ? { native } : {}), ...(t.title !== undefined ? { title: str(t.title, `${f}.title`) } : {}) }
    })
    const mcp = r.mcpServers === undefined ? {} : r.mcpServers
    if (!isObj(mcp)) fail('mcpServers must be an object of servers')
    const mcpServers = Object.fromEntries(Object.entries(mcp as Record<string, unknown>).map(([k, v]) => {
      const f = `mcpServers.${k}`
      if (!isObj(v)) fail(`${f} must be an object`)
      const strMap = (x: unknown, field: string) => {
        if (x !== undefined && (!isObj(x) || Object.values(x).some((y) => typeof y !== 'string'))) fail(`${field} must map names to text`)
        return x as Record<string, string> | undefined
      }
      if (v.url !== undefined || v.type === 'http' || v.type === 'sse' || v.type === 'streamable-http') {
        const url = str(v.url, `${f}.url`)
        if (!/^https?:\/\/[^/]/i.test(url)) fail(`${f}.url must start with https://`)
        const headers = strMap(v.headers, `${f}.headers`)
        let oauth: McpUrlConfig['oauth']
        if (v.oauth !== undefined) {
          if (!isObj(v.oauth)) fail(`${f}.oauth must be an object`)
          oauth = { clientId: str(v.oauth.clientId, `${f}.oauth.clientId`), ...(v.oauth.clientSecret !== undefined ? { clientSecret: str(v.oauth.clientSecret, `${f}.oauth.clientSecret`) } : {}) }
        }
        return [k, { url, ...(v.type === 'sse' ? { type: 'sse' as const } : {}), ...(headers ? { headers } : {}), ...(oauth ? { oauth } : {}) }]
      }
      const args = list(v.args, `${f}.args`).map((a, i) => str(a, `${f}.args[${i}]`, false))
      const env = strMap(v.env, `${f}.env`)
      return [k, { command: str(v.command, `${f}.command`), ...(v.args !== undefined ? { args } : {}), ...(env ? { env } : {}) }]
    }))
    const settings = list(r.settings, 'settings').map((s, i): PluginSetting => {
      const f = `settings[${i}]`
      if (!isObj(s)) fail(`${f} must be an object`)
      const key = str(s.key, `${f}.key`)
      if (!SETTING_KEY.test(key)) fail(`${f}.key must be UPPER_CASE, like "API_KEY"`)
      const kind = s.type === undefined ? 'text' : str(s.type, `${f}.type`)
      if (!KINDS.includes(kind as SettingKind)) fail(`${f}.type must be one of ${KINDS.join(', ')}`)
      return {
        key, label: str(s.label, `${f}.label`), ...(s.secret ? { secret: true } : {}), ...(s.help !== undefined ? { help: str(s.help, `${f}.help`) } : {}),
        ...(kind !== 'text' ? { kind: kind as SettingKind } : {}), ...(s.required ? { required: true } : {}), ...(s.multiple ? { multiple: true } : {}),
        ...(s.default !== undefined ? { default: Array.isArray(s.default) ? s.default.map(String).join('\n') : String(s.default) } : {}),
      }
    })
    const starters = list(r.starters, 'starters').map((s, i): Starter => {
      if (!isObj(s)) fail(`starters[${i}] must be an object`)
      return { title: str(s.title, `starters[${i}].title`), prompt: str(s.prompt, `starters[${i}].prompt`), ...(s.file === true ? { file: true } : {}) }
    })
    const perms = isObj(r.permissions) ? r.permissions : {}
    return {
      manifest: {
        id, name: str(r.name, 'name'), version: str(r.version, 'version', false) || '0.0.0',
        description: str(r.description, 'description', false), ...(r.author !== undefined ? { author: str(r.author, 'author') } : {}),
        icon: str(r.icon, 'icon', false) || 'puzzle', permissions: { network: perms.network === true },
        starters, tools, mcpServers, settings,
        ...(r.prompt !== undefined ? { prompt: str(r.prompt, 'prompt').slice(0, 600) } : {}),
        ...(Array.isArray(r.platforms) ? { platforms: r.platforms.map(String) } : {}),
      },
    }
  } catch (err) {
    if (err instanceof Bad) return { error: err.message }
    throw err
  }
}
