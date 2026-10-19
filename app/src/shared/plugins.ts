/** builtin: ships with Hob · installed: copied into Hob · linked: a developer's folder, reloaded on change */
export type PluginSource = 'builtin' | 'installed' | 'linked'
/** what the plugin can do, in rising order of trust (online: talks to a service on the internet, runs nothing here) */
export type PluginTrust = 'instructions' | 'code' | 'network' | 'online' | 'full'
export type SettingKind = 'text' | 'number' | 'boolean' | 'directory' | 'file'
export type PluginSettingInfo = {
  key: string; label: string; secret: boolean; help?: string; set: boolean; value?: string
  kind: SettingKind; required: boolean; multiple: boolean; default?: string
}

export type PluginInfo = {
  id: string
  name: string
  description: string
  version: string
  author?: string
  icon: string
  /** the plugin's own picture (an .mcpb bundle's icon), as a data: URL */
  image?: string
  source: PluginSource
  enabled: boolean
  /** the plugin couldn't load (bad hob-plugin.json, missing files) or its app connection failed */
  error?: string
  dir: string
  trust: PluginTrust
  skills: { name: string; description: string }[]
  tools: string[]
  /** MCP servers (app connections) */
  apps: string[]
  starters: { title: string; prompt: string }[]
  settings: PluginSettingInfo[]
  /** an online app connection needs the user to sign in (again) */
  signIn?: boolean
  /** signed in to an online app connection (can sign out) */
  signedIn?: boolean
}

/** a skill as the composer's / menu shows it */
export type SkillRef = { name: string; description: string; pluginId: string; pluginName: string; icon: string }
/** file: asks the user for a file first, then sends the prompt with it */
export type StarterRef = { title: string; prompt: string; icon: string; pluginId: string; file?: boolean }

export type NewSkill = { name: string; description: string; instructions: string }
export type PluginResult = { ok: true; id: string } | { ok: false; error: string }
export type InstallResult = PluginResult | { ok: false; canceled: true } | null
