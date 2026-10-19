import { EventEmitter } from 'node:events'
import { expect, it } from 'vitest'
import { parseSearx, searxSettings, SearxngServer } from '../src/main/search/searxng'

it('settings: local only, JSON output, several engines, no rate limiter', () => {
  const y = searxSettings({ port: 4321, secret: 'abc' })
  expect(y).toContain('bind_address: "127.0.0.1"')
  expect(y).toContain('port: 4321')
  expect(y).toContain('secret_key: "abc"')
  expect(y).toContain('formats: [json]')
  expect(y).toContain('limiter: false')
  for (const e of ['bing', 'mojeek', 'startpage', 'wikipedia', 'yahoo', 'yandex']) expect(y).toContain(`name: ${e}`)
  // Bing sends decoy results to automated searches: it counts for less
  expect(y).toMatch(/name: bing\n    disabled: false\n    weight: 0\.5/)
})

it('parses results, drops duplicates and empties, keeps the top N', () => {
  const r = parseSearx({ results: [
    { title: 'A', url: 'https://a.com', content: 'first' },
    { title: 'A again', url: 'https://a.com', content: 'dup' },
    { title: '', url: 'https://empty.com', content: '' },
    { title: 'B', url: 'https://b.com', content: 'second' },
  ] }, 5)
  expect(r).toEqual([{ title: 'A', url: 'https://a.com', snippet: 'first' }, { title: 'B', url: 'https://b.com', snippet: 'second' }])
})

class FakeProc extends EventEmitter {
  killed = false
  kill() { this.killed = true; this.emit('exit', 0) }
}
const fakeProc = () => new FakeProc()

it('starts once for concurrent searches, waits until healthy, restarts after it dies', async () => {
  const procs: ReturnType<typeof fakeProc>[] = []
  let healthy = false
  const server = new SearxngServer({
    python: '/py', runtimeRoot: '/rt', settingsDir: '/tmp',
    freePort: async () => 5555,
    spawn: () => { const p = fakeProc(); procs.push(p); setTimeout(() => { healthy = true }, 30); return p },
    writeFile: () => {},
    fetch: (async (url: string) => {
      if (url.endsWith('/healthz')) { if (!healthy) throw new Error('not yet'); return new Response('OK') }
      return new Response(JSON.stringify({ results: [{ title: 'T', url: 'https://t.com', content: 's' }] }))
    }) as typeof fetch,
  })
  const [a, b] = await Promise.all([server.search('x'), server.search('y')])
  expect(procs).toHaveLength(1)
  expect(a[0].title).toBe('T'); expect(b).toHaveLength(1)
  procs[0].emit('exit', 1); healthy = false
  await server.search('z')
  expect(procs).toHaveLength(2)
  server.stop()
  expect(procs[1].killed).toBe(true)
})

it('marks results only Bing found, so they are checked more strictly', () => {
  const r = parseSearx({ results: [{ title: 'a', url: 'https://a', engines: ['bing'] }, { title: 'b', url: 'https://b', engines: ['bing', 'yahoo'] }, { title: 'c', url: 'https://c' }] })
  expect(r.map((x) => x.strict)).toEqual([true, undefined, undefined])
})
