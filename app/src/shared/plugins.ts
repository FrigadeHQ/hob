/** builtin: ships with Garth · installed: copied into Garth · linked: a developer's folder, reloaded on change */
export type PluginSource = 'builtin' | 'installed' | 'linked'
/** what the plugin can do, in rising order of trust (online: talks to a service on the internet, runs nothing here) */
export type PluginTrust = 'instructions' | 'builtin' | 'code' | 'network' | 'online' | 'full'
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
  /** connector: only links Garth to an outside service (MCP). skills: the user's own skills. plugin: a bundle of skills and tools */
  kind: 'plugin' | 'connector' | 'skills'
  enabled: boolean
  /** the plugin couldn't load (bad garth-plugin.json, missing files) or its connector failed */
  error?: string
  dir: string
  trust: PluginTrust
  skills: { name: string; description: string }[]
  tools: string[]
  /** MCP servers (connectors) */
  apps: string[]
  starters: { title: string; prompt: string }[]
  settings: PluginSettingInfo[]
  /** an online connector needs the user to sign in (again) */
  signIn?: boolean
  /** signed in to an online connector (can sign out) */
  signedIn?: boolean
}

/** a skill as the composer's / menu shows it */
export type SkillRef = { name: string; description: string; pluginId: string; pluginName: string; icon: string }
/** file: asks the user for a file first, then sends the prompt with it */
/** connect: opens "connect your email and calendar" instead of sending a prompt */
export type StarterRef = { title: string; prompt: string; icon: string; pluginId: string; file?: boolean; connect?: boolean }

/** files: scripts and data saved next to SKILL.md. network: its scripts may use the internet. packages: from PyPI, pinned (yfinance==0.2.54) */
export type NewSkill = { name: string; description: string; instructions: string; files?: Record<string, string>; network?: boolean; packages?: string[] }
export type PluginResult = { ok: true; id: string } | { ok: false; error: string }
export type InstallResult = PluginResult | { ok: false; canceled: true } | null
