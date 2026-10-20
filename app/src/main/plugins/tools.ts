import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { Tool, TurnCtx } from '../agent/tool'
import { runPython } from '../python/run'
import { LAUNCH } from '../tools/python'
import type { ManifestTool } from './manifest'
import type { McpCallResult, McpTool } from './mcp'

/** what a tool needs to know about the plugin it belongs to */
export type PluginRef = { id: string; name: string; dir: string; network: boolean; env: Record<string, string> }

/** "Converted {amount} {from}" + args → "Converted 5 EUR" */
export const fillTitle = (template: string, args: Record<string, unknown>) =>
  template.replace(/\{(\w+)\}/g, (m, k: string) => (args[k] === undefined ? m : String(args[k]))).slice(0, 120)

/** names an MCP server uses (dashes, dots) → names every model accepts */
export const safeToolName = (n: string) => n.replace(/[^A-Za-z0-9_]/g, '_').replace(/^([^A-Za-z])/, 't$1').slice(0, 64)

const files = (dir: string) => {
  const m = new Map<string, number>()
  const walk = (d: string, depth: number) => {
    let names: string[] = []
    try { names = readdirSync(d) } catch { return }
    for (const n of names) {
      if (n.startsWith('.')) continue
      const p = join(d, n)
      const st = statSync(p)
      if (st.isDirectory()) { if (depth < 2) walk(p, depth + 1) } else m.set(p, st.mtimeMs)
    }
  }
  walk(dir, 0)
  return m
}

/** A plugin's Python tool: args as JSON on stdin, result on stdout, in the same sandbox as run_python. */
export function pythonTool(p: PluginRef, t: ManifestTool, name = t.name): Tool<Record<string, unknown>> {
  return {
    spec: { name, description: t.description, params: t.params },
    title: (a) => (t.title ? fillTitle(t.title, a) : `Used ${p.name}`),
    action: () => (p.network ? { kind: 'web' } : { kind: 'run' }),
    needsWeb: p.network,
    async run(a, ctx) {
      if (!ctx.python) throw new Error('Code tools are not available.')
      if (!ctx.python.isReady()) ctx.progress?.('Setting up code tools…')
      const python = await ctx.python.ensure()
      const before = files(ctx.chatDir)
      const r = await runPython({
        python, runtimeRoot: ctx.python.dir, cwd: ctx.chatDir, tmpDir: ctx.runTmp, signal: ctx.signal, timeoutMs: 60_000,
        readPaths: [p.dir, ...ctx.grants], network: p.network, stdin: JSON.stringify(a ?? {}),
        env: { ...p.env, HOB_CHAT_DIR: ctx.chatDir, HOB_PLUGIN_DIR: p.dir },
        code: LAUNCH(join(p.dir, t.run!)),
      })
      if (p.network) ctx.untrusted = true
      const made = [...files(ctx.chatDir)].filter(([f, m]) => before.get(f) !== m).map(([f]) => f)
      if (r.stopped) return { text: 'Stopped by the user.', failed: true }
      if (r.timedOut) return { text: `${p.name} took longer than a minute and was stopped.`, failed: true }
      if (r.exitCode !== 0) return { text: `${p.name} ran into a problem:\n${r.output}`, detail: r.output, failed: true }
      const out = r.stdout.trim()
      let text = out
      let extra: string[] = []
      if (out.startsWith('{')) {
        try {
          const j = JSON.parse(out) as { text?: unknown; files?: unknown }
          if (typeof j.text === 'string') text = j.text
          if (Array.isArray(j.files)) extra = j.files.filter((f): f is string => typeof f === 'string').map((f) => join(ctx.chatDir, f))
        } catch { /* plain text that starts with { */ }
      }
      const all = [...new Set([...made, ...extra])]
      return { text: text || '(no result)', files: all, ...(all.length ? { detail: `Files: ${all.map((f) => relative(ctx.chatDir, f)).join(', ')}` } : {}) }
    },
  }
}

const IMAGE_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }

/** MCP result → text for the model; images become files in the chat folder */
export function mcpOutput(r: McpCallResult, ctx: Pick<TurnCtx, 'chatDir'>, label: string) {
  const texts: string[] = []
  const made: string[] = []
  for (const c of r.content ?? []) {
    if (c.type === 'text' && typeof c.text === 'string') texts.push(c.text)
    else if (c.type === 'image' && typeof c.data === 'string') {
      const f = join(ctx.chatDir, `${label}-${Date.now()}-${made.length + 1}.${IMAGE_EXT[String(c.mimeType)] ?? 'png'}`)
      writeFileSync(f, Buffer.from(c.data, 'base64'))
      made.push(f)
      texts.push(`[image saved as ${relative(ctx.chatDir, f)}]`)
    } else if (c.type === 'resource' && c.resource && typeof c.resource === 'object') {
      const res = c.resource as { uri?: string; text?: string }
      texts.push(res.text ?? `[resource ${res.uri ?? ''}]`)
    }
  }
  return { text: texts.join('\n') || '(no result)', files: made, failed: !!r.isError }
}

/** many servers give no hints: a name that only reads ("get_issue", "searchDocs") is treated as read-only */
// ("query" isn't one: database servers run any SQL through it)
const READ_VERB = /^(?:get|list|read|search|find|fetch|lookup|describe|ask|show|view|count|browse)(?:[_\-.A-Z]|$)/
const CHANGE_WORD = /(?:^|[_\-.]|[a-z])(?:create|add|update|set|delete|remove|send|post|write|edit|move|reset|clear|run|exec|archive|cancel|close|merge|publish|upload|replace|drop|kill|purge|apply|insert|modify|rename|revoke|grant|pay|buy|order|book|transfer)/i
const readsOnly = (name: string) => READ_VERB.test(name) && !CHANGE_WORD.test(name.replace(READ_VERB, ''))

/** One tool of a plugin's MCP server. Tools that say they're destructive ask first. */
export function mcpTool(p: PluginRef, t: McpTool, call: (name: string, args: unknown, signal: AbortSignal) => Promise<McpCallResult>, name = safeToolName(t.name)): Tool<Record<string, unknown>> {
  const label = t.annotations?.title ?? t.title ?? t.name
  const schema = t.inputSchema && t.inputSchema.type === 'object' ? t.inputSchema : { type: 'object', properties: {} }
  return {
    spec: { name, description: (t.description ?? label).slice(0, 1000), params: schema },
    title: () => `Used ${p.name}: ${label}`,
    // MCP's default for a tool without hints is "may change things": ask, unless it says it only reads.
    // After web or app content entered the task, anything that isn't read-only asks.
    action: (_a, ctx) => {
      const readOnly = t.annotations?.readOnlyHint === true || (t.annotations?.readOnlyHint === undefined && t.annotations?.destructiveHint === undefined && readsOnly(t.name))
      const harmless = readOnly || t.annotations?.destructiveHint === false
      return { kind: 'app', ask: readOnly ? false : !harmless || !!ctx?.untrusted }
    },
    ask: () => `Let ${p.name} do “${label}”?`,
    async run(a, ctx) {
      const r = await call(t.name, a, ctx.signal)
      // another program's output may carry instructions: treat it like web content
      ctx.untrusted = true
      return mcpOutput(r, ctx, safeToolName(p.id))
    },
  }
}
