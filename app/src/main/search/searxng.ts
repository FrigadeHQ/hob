import { spawn as nodeSpawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'

/** Pinned SearXNG source (AGPL-3.0, run unmodified as a separate local process): https://github.com/searxng/searxng */
export const SEARXNG_COMMIT = '4e2c1ea7f468c9d1b16206e9d4079999a2eb0627'
export const SEARXNG_SHA256 = 'b44e7758336f84af2e5d9dcd61f40d8d761d386f0d63ac9b8a78430def602495'
export const SEARXNG_URL = `https://github.com/searxng/searxng/archive/${SEARXNG_COMMIT}.tar.gz`

/** strict: only a decoy-prone engine (Bing) found it, so it's checked more strictly */
export type SearchResult = { title: string; url: string; snippet: string; strict?: boolean }

// Yahoo and Yandex answer automated searches reliably; Google, Brave and DuckDuckGo often block them;
// Bing sometimes sends decoy results, so it counts for less when results are ranked
const ENGINES: { name: string; weight?: number }[] = [
  { name: 'google' }, { name: 'bing', weight: 0.5 }, { name: 'brave' }, { name: 'duckduckgo' }, { name: 'mojeek' },
  { name: 'startpage' }, { name: 'wikipedia' }, { name: 'yahoo' }, { name: 'yandex' },
]

/** Local-only metasearch: many engines at once, so one blocking us doesn't matter. */
export function searxSettings(o: { port: number; secret: string }): string {
  return `use_default_settings: true
general:
  instance_name: "Hob"
server:
  secret_key: "${o.secret}"
  bind_address: "127.0.0.1"
  port: ${o.port}
  limiter: false
  image_proxy: false
search:
  formats: [json]
  safe_search: 1
engines:
${ENGINES.map((e) => `  - name: ${e.name}\n    disabled: false${e.weight ? `\n    weight: ${e.weight}` : ''}`).join('\n')}
`
}

// more than the tool shows: some are dropped as off-topic
export function parseSearx(json: unknown, max = 20): SearchResult[] {
  const seen = new Set<string>()
  const out: SearchResult[] = []
  for (const r of (json as { results?: { title?: string; url?: string; content?: string; engines?: string[] }[] }).results ?? []) {
    if (!r.title || !r.url || seen.has(r.url)) continue
    seen.add(r.url)
    const strict = r.engines?.length === 1 && r.engines[0] === 'bing'
    out.push({ title: r.title.trim(), url: r.url, snippet: (r.content ?? '').trim(), ...(strict ? { strict } : {}) })
    if (out.length >= max) break
  }
  return out
}

type Proc = { kill(): unknown; once(event: 'exit', cb: () => void): unknown }
export type SearxngDeps = {
  python: string
  runtimeRoot: string
  settingsDir: string
  spawn?: (cmd: string, args: string[], env: Record<string, string>, cwd: string) => Proc
  freePort?: () => Promise<number>
  writeFile?: (path: string, text: string) => void
  fetch?: typeof fetch
}

const freePortReal = () => new Promise<number>((resolve, reject) => {
  const s = createServer()
  s.once('error', reject)
  s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)) })
})

/** SearXNG running on this computer, started on the first search and restarted if it dies. */
export class SearxngServer {
  private starting: Promise<number> | undefined
  private proc: Proc | undefined
  constructor(private d: SearxngDeps) {}

  private get fetch() { return this.d.fetch ?? fetch }

  private start(): Promise<number> {
    return (this.starting ??= (async () => {
      const port = await (this.d.freePort ?? freePortReal)()
      const settings = join(this.d.settingsDir, 'searxng-settings.yml')
      ;(this.d.writeFile ?? writeFileSync)(settings, searxSettings({ port, secret: randomBytes(16).toString('hex') }))
      const src = join(this.d.runtimeRoot, 'searxng')
      const env = { ...process.env, SEARXNG_SETTINGS_PATH: settings, PYTHONPATH: src } as Record<string, string>
      const spawnIt = this.d.spawn ?? ((cmd, args, e, cwd) => nodeSpawn(cmd, args, { env: e, cwd, stdio: 'ignore' }))
      const proc = spawnIt(this.d.python, ['-m', 'searx.webapp'], env, src)
      this.proc = proc
      proc.once('exit', () => { if (this.proc === proc) { this.proc = undefined; this.starting = undefined } })
      for (let i = 0; i < 300; i++) {
        try { if ((await this.fetch(`http://127.0.0.1:${port}/healthz`)).ok) return port } catch { /* not up yet */ }
        if (this.proc !== proc) break
        await new Promise((r) => setTimeout(r, 100))
      }
      this.stop()
      throw new Error('Web search did not start')
    })())
  }

  async search(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
    const port = await this.start()
    const res = await this.fetch(`http://127.0.0.1:${port}/search?q=${encodeURIComponent(query)}&format=json`, { signal })
    return parseSearx(await res.json())
  }

  stop() {
    const p = this.proc
    this.proc = undefined
    this.starting = undefined
    p?.kill()
  }
}
