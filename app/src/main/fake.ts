import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DownloadDeps } from './downloader'
import { TITLE_PROMPT } from './agent/prompt'
import { InsufficientMemoryError, type ChatHandlers, type ChatRequest, type Engine, type GpuProbe } from './engine'

/** Used when HOB_FAKE=1 (E2E tests) and in unit tests. */
export class FakeEngine implements Engine {
  loaded: string | undefined
  failLoadFor = new Set<string>()
  constructor(public gpu: GpuProbe = { gpuType: 'metal', vramTotalGB: 24, unifiedGB: 24, gpuNames: ['Apple M1 Max'] }) {}
  async probe() { return this.gpu }
  async load(modelPath: string) {
    if ([...this.failLoadFor].some((f) => modelPath.includes(f))) throw new InsufficientMemoryError('fake OOM')
    this.loaded = modelPath
  }
  lastRequest: ChatRequest | undefined
  /** the last "name this chat" request (kept apart so lastRequest stays the conversation) */
  lastTitleRequest: ChatRequest | undefined
  async chat(req: ChatRequest, h: ChatHandlers, signal?: AbortSignal) {
    if (req.messages[0]?.content.startsWith(TITLE_PROMPT)) this.lastTitleRequest = req
    else this.lastRequest = req
    const onToken = h.onToken
    const said = req.messages.at(-1)?.content ?? ''
    const first = said.split('\n')[0]
    if (first.startsWith('__tools__ ')) {
      const results: string[] = []
      for (const [name, args] of JSON.parse(first.slice('__tools__ '.length)) as [string, unknown][]) {
        if (signal?.aborted) break
        results.push(h.onTool ? await h.onTool(name, args) : 'no tools')
      }
      const reply = `Done. ${results.at(-1) ?? ''}`.trim()
      onToken(reply)
      return reply
    }
    // naming a chat: deterministic, keeps the user's first words so tests can find the chat
    if (req.messages[0]?.content.startsWith(TITLE_PROMPT)) return `Title for: ${said.replace(/^User: /, '').split('\n\nAssistant:')[0].split(/\s+/).slice(0, 4).join(' ')}`
    if (said === '__empty__') return ''
    if (said === '__error__') throw new Error('boom')
    if (said === '__slow__') {
      let out = ''
      for (const w of ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']) {
        if (signal?.aborted) return out
        onToken(w + ' '); out += w + ' '
        await new Promise((r) => setTimeout(r, 300))
      }
      return out
    }
    if (said === '__think__') {
      for (const w of ['Hmm,', 'weighing', 'the', 'options', 'here…']) { onToken(w + ' ', true); await new Promise((r) => setTimeout(r, 400)) }
      onToken('Here is my answer.')
      return 'Here is my answer.'
    }
    if (first === '__loop__') {
      const para = "Let's try a fresh batch of unique made-up names: Zylo, Kora, Vexi, Qub, Jaxo, Nex, Omi. Let me search for these new ones now.\n\n"
      let out = 'Here we go. '
      onToken(out)
      for (let i = 0; i < 20 && !signal?.aborted; i++) { onToken(para); out += para; await new Promise((r) => setTimeout(r, 50)) }
      return out
    }
    if (first === '__narrate__') {
      onToken('Let me look first. ')
      await new Promise((r) => setTimeout(r, 1500))
      const r = h.onTool ? await h.onTool('list_files', {}) : ''
      await new Promise((r) => setTimeout(r, 1500))
      return `All done. ${r.split('\n')[0]}`
    }
    // says it renamed files without doing it; after Hob's check, owns up (or with "stubborn", says it again)
    if (first.startsWith('__ask__ ')) {
      if (h.onTool) await h.onTool('list_files', { path: first.slice('__ask__ '.length) })
      return "Here's my plan: read the dates, then rename. Let me know if you'd like me to proceed."
    }
    if (said.startsWith('[Note from Hob') && said.includes("don't ask whether to go ahead")) return 'Renamed them.'
    if (said.startsWith('[Note from Hob') && said.includes('you stopped before finishing')) return 'Finished it.'
    // does a step, then stops without a word
    if (said === '__quit__') { if (h.onTool) await h.onTool('list_files', {}); return '' }
    if (first.startsWith('__claim__')) return 'The files have been renamed. All new names are in ~/Desktop/hob-test.'
    if (said.startsWith('[Note from Hob')) {
      const asked = [...req.messages].reverse().find((m) => m.role === 'user' && !m.content.startsWith('[Note from Hob'))?.content ?? ''
      return asked.includes('stubborn') ? 'Done, the files have been renamed.' : "Sorry, I haven't renamed them yet. I only made a list of the new names."
    }
    if (said === '__img__') return 'Here: ![leak](https://example.com/x.png?q=secret) done'
    if (said === '__table__') return '| Region | Sales |\n|---|---|\n| North | 10 |\n| South | 30 |'
    if (said === '__link__') return 'See the [example site](https://example.com).'
    const reply = `You said: ${said}`
    for (const word of reply.split(' ')) {
      if (signal?.aborted) break
      onToken(word + ' ')
      await new Promise((r) => setTimeout(r, 10))
    }
    return reply
  }
  async unload() { this.loaded = undefined }
  private exitListeners: (() => void)[] = []
  onExit(cb: () => void) { this.exitListeners.push(cb) }
  /** Simulate the engine process dying. */
  crash() { this.loaded = undefined; for (const cb of this.exitListeners) cb() }
  dispose() {}
}

export const fakeDownloadDeps = (opts: { freeDiskGB?: number; stepMs?: number } = {}): DownloadDeps => ({
  async download(_url, dir, fileName, onProgress) {
    for (const f of [0.25, 0.5, 0.75, 1]) { onProgress({ fraction: f, etaSec: 0 }); await new Promise((r) => setTimeout(r, opts.stepMs ?? 20)) }
    writeFileSync(join(dir, fileName), 'fake')
  },
  async hashFile() { return 'FAKE' },
  async freeDiskGB() { return opts.freeDiskGB ?? 1000 },
})
