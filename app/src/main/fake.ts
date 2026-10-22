import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DownloadDeps } from './downloader'
import { TITLE_PROMPT } from './agent/prompt'
import { InsufficientMemoryError, type ChatHandlers, type ChatRequest, type Engine, type GpuProbe } from './engine'

/** Used when GARTH_FAKE=1 (E2E tests) and in unit tests. */
export class FakeEngine implements Engine {
  loaded: string | undefined
  failLoadFor = new Set<string>()
  constructor(public gpu: GpuProbe = { gpuType: 'metal', vramTotalGB: 24, unifiedGB: 24, gpuNames: ['Apple M1 Max'] }) {}
  async probe() { return this.gpu }
  async load(modelPath: string) {
    if ([...this.failLoadFor].some((f) => modelPath.includes(f))) throw new InsufficientMemoryError('fake OOM')
    this.loaded = modelPath
  }
  /** what was read ahead last (system prompt + history) */
  lastPreload: ChatRequest['messages'] | undefined
  preloads = 0
  async preload(messages: ChatRequest['messages']) { this.lastPreload = messages; this.preloads++ }
  side: string | undefined
  async loadSide(modelPath: string) { this.side = modelPath }
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
      // "__tools__ [...]\n---\nreply": the reply to give after the tools, when a test needs a particular one
      const body = said.slice(said.indexOf('__tools__ ') + '__tools__ '.length)
      const [calls, given] = body.includes('\n---\n') ? body.split('\n---\n') : [first.slice('__tools__ '.length), undefined]
      for (const [name, args] of JSON.parse(calls) as [string, unknown][]) {
        if (signal?.aborted) break
        results.push(h.onTool ? await h.onTool(name, args) : 'no tools')
      }
      const reply = given ?? `Done. ${results.at(-1) ?? ''}`.trim()
      onToken(reply)
      return reply
    }
    // naming a chat: deterministic, keeps the user's first words so tests can find the chat
    if (req.messages[0]?.content.startsWith(TITLE_PROMPT)) return `Title for: ${said.replace(/^User: /, '').split('\n\nAssistant:')[0].split(/\s+/).slice(0, 4).join(' ')}`
    if (said === '__empty__') return ''
    if (said === '__error__') throw new Error('boom')
    // streams Markdown in small pieces, so a bold word arrives as "**", "Impor", "tant", "**"
    if (said === '__markdown__') {
      const parts = ['This is ', '**', 'Impor', 'tant', '**', ' and ', '*', 'quite', '*', ' ', '`cod', 'e`', ' done.']
      for (const p of parts) { if (signal?.aborted) break; onToken(p); await new Promise((r) => setTimeout(r, 250)) }
      return parts.join('')
    }
    if (said === '__slow__' || said === '__slower__') {
      let out = ''
      const words = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']
      // __slower__: ~10s, for tests that leave the chat and come back while it's still going
      for (const w of said === '__slower__' ? [...words.slice(0, -1), ...Array(25).fill('more'), 'eight'] : words) {
        if (signal?.aborted) return out
        onToken(w + ' '); out += w + ' '
        await new Promise((r) => setTimeout(r, 300))
      }
      return out
    }
    if (said === '__think__') {
      for (const w of ['Hmm,', 'weighing', 'the', 'options', 'here', 'and', 'checking', 'again…']) { onToken(w + ' ', true); await new Promise((r) => setTimeout(r, 600)) }
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
    // says it renamed files without doing it; after Garth's check, owns up (or with "stubborn", says it again)
    if (first.startsWith('__ask__ ')) {
      if (h.onTool) await h.onTool('list_files', { path: first.slice('__ask__ '.length) })
      return "Here's my plan: read the dates, then rename. Let me know if you'd like me to proceed."
    }
    if (said.startsWith('[Note from Garth') && said.includes("don't ask whether to go ahead")) return 'Renamed them.'
    if (said.startsWith('[Note from Garth') && said.includes('you stopped before finishing')) return 'Finished it.'
    // does a step, then stops without a word
    if (said === '__quit__') { if (h.onTool) await h.onTool('list_files', {}); return '' }
    if (first.startsWith('__claim__')) return 'The files have been renamed. All new names are in ~/Desktop/garth-test.'
    if (said.startsWith('[Note from Garth')) {
      const asked = [...req.messages].reverse().find((m) => m.role === 'user' && !m.content.startsWith('[Note from Garth'))?.content ?? ''
      return asked.includes('stubborn') ? 'Done, the files have been renamed.' : "Sorry, I haven't renamed them yet. I only made a list of the new names."
    }
    if (said === '__saved__') return 'Jeg har gemt filen indkob.txt med din indkøbsliste.'
    if (said === '__img__') return 'Here: ![leak](https://example.com/x.png?q=secret) done'
    if (said === '__plan__') return 'Here is a plan.\n\n| Day | Focus (Topic) | Activity | Suggested Resources |\n|---|---|---|---|\n| Day 1 | **Grammar basics** – noun gender, definite/indefinite forms | • Review notes on gender rules.<br>• Do 10 fill-in-the-blank exercises. | *Danish Grammar* PDF (downloaded from your course site). |\n| Day 2 | **Verb conjugations** – present, past, future | • Flashcards for irregular verbs.<br>• Write 5 sentences using each tense. | *Verb Drill* worksheet. |\n| Day 10 | **Speaking practice** – role-play | • Pair with a study buddy or use a language-exchange app.<br>• Practice ordering food. | *Duolingo Danish* conversation mode. |'
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
  async download(_url, dir, fileName, onProgress, signal) {
    for (const f of [0.25, 0.5, 0.75, 1]) {
      if (signal?.aborted) throw Object.assign(new Error('Download stopped'), { name: 'AbortError' })
      onProgress({ fraction: f, etaSec: 0 }); await new Promise((r) => setTimeout(r, opts.stepMs ?? 20))
    }
    if (signal?.aborted) throw Object.assign(new Error('Download stopped'), { name: 'AbortError' })
    writeFileSync(join(dir, fileName), 'fake')
  },
  async hashFile() { return 'FAKE' },
  async freeDiskGB() { return opts.freeDiskGB ?? 1000 },
})

/** fake mode: signing in to Google or Microsoft works at once, with a small calendar and inbox */
export function fakeAccounts(): import('./accounts').AccountsLike {
  let current: import('./accounts').Account | undefined
  return {
    // like the real app: Google and Microsoft sign-in stays off until it has client IDs (Mac apps only for now)
    available: () => [],
    current: () => current,
    signIn: async (provider) => (current = { provider, email: provider === 'google' ? 'me@gmail.com' : 'me@outlook.com' }),
    cancelSignIn: () => {},
    signOut: () => { current = undefined },
    calMail: () => current && {
      name: `the ${current.provider === 'google' ? 'Google' : 'Microsoft'} account ${current.email}`,
      events: async () => [{ title: 'Team lunch', start: '2026-10-22T12:00:00Z', end: '2026-10-22T13:00:00Z', allDay: false, calendar: current!.email }],
      addEvent: async (e) => ({ title: e.title, start: e.start, calendar: current!.email }),
      searchMail: async () => [{ id: 'g1', subject: 'Your order shipped', from: 'Shop <hi@shop.com>', date: '2026-10-20T08:00:00Z', read: false }],
      readMail: async (id) => (id === 'g1' ? { subject: 'Your order shipped', from: 'Shop', date: '2026-10-20T08:00:00Z', to: [current!.email], content: 'It arrives Friday.' } : undefined),
      draft: async () => 'in Drafts',
    },
  }
}
