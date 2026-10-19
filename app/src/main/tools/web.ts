import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import { PREVIEW_CHARS, type Tool, type TurnCtx } from '../agent/tool'

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' }
const decode = (s: string) => s.replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e] ?? (e.startsWith('#') ? String.fromCodePoint(Number(e.slice(1).replace(/^x/, '0x'))) : m))
const strip = (s: string) => decode(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()

/** Plain text of any HTML: the fallback when a page has no article. */
export function htmlToText(html: string): string {
  return decode(html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr|\/section|\/article)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n')
}

/** The main article of a page (Firefox Reader View's algorithm), without menus and footers. */
export function readable(html: string, url: string): string {
  try {
    const { document } = parseHTML(html)
    Object.defineProperty(document, 'baseURI', { value: url })
    const article = new Readability(document as unknown as Document).parse()
    const text = article?.textContent?.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n')
    if (text && text.length > 200) return article?.title ? `${article.title}\n${text}` : text
  } catch { /* fall through */ }
  return htmlToText(html)
}

const BOT_WALL = /just a moment|checking your browser|enable javascript|attention required|verify you are (a )?human|captcha|access denied/i

/** what a current desktop browser sends; bare script requests get blocked by most sites */
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
}

const withTimeout = (signal: AbortSignal) => AbortSignal.any([signal, AbortSignal.timeout(15_000)])

/** strict: only a search engine known to send decoys found it */
type Result = { title: string; url: string; snippet: string; strict?: boolean }

async function wikipedia(query: string, ctx: TurnCtx): Promise<Result[]> {
  const res = await ctx.fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=5&srsearch=${encodeURIComponent(query)}`, { signal: withTimeout(ctx.signal) })
  const json = (await res.json()) as { query?: { search?: { title: string; snippet: string }[] } }
  return (json.query?.search ?? []).map((r) => ({ title: r.title, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`, snippet: strip(r.snippet) }))
}

const STOP = new Set(('a an the and or but of in on at to for from by with about as into is are was were be been being am do does did done have has had ' +
  'what whats which who whom whose when where why how this that these those it its i me my we our you your he she they them their ' +
  'can could should would will shall may might must not no yes any some all more most very just please tell know find search show give get ' +
  'like there here than then also out up down over under near best good new today now').split(' '))

/** the words a result has to mention to be about the question: "What is Frigade?" → ["frigade"] */
export function keywords(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => (w.length >= 3 || /\d/.test(w)) && !STOP.has(w)))]
}

/**
 * Search engines sometimes answer automated searches with decoys (pages about something else entirely).
 * Keep results that mention at least one key word of the question.
 */
export function onTopic(results: Result[], query: string): Result[] {
  // a rough stem, so "hikes" matches "hiking" and "founded" matches "founder"
  const stems = keywords(query).map((w) => (w.length <= 4 ? w : w.slice(0, w.length - (w.length <= 6 ? 2 : 3))))
  if (!stems.length) return results
  return results.filter((r) => {
    const text = `${r.title} ${r.snippet} ${r.url}`.toLowerCase()
    // decoys echo one word of the question ("BEST | Merriam-Webster"): a result only a decoy-prone engine found must match them all
    return r.strict ? stems.every((w) => text.includes(w)) : stems.some((w) => text.includes(w))
  })
}

export const webSearch: Tool<{ query: string }> = {
  spec: { name: 'web_search', description: 'Search the web for current information. Returns titles, links and snippets; use fetch_url to read a page.', params: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  title: (a) => `Searched the web for “${a.query}”`,
  action: () => ({ kind: 'web' }),
  async run(a, ctx) {
    ctx.untrusted = true
    let results: Result[] = []
    const search = async (q: string) => { try { return onTopic((await ctx.search?.(q, ctx.signal)) ?? [], a.query).slice(0, 8) } catch { return [] } }
    results = await search(a.query)
    // a whole page of decoys: ask again with only the words that matter
    const short = keywords(a.query).join(' ')
    if (!results.length && short && short !== a.query.trim().toLowerCase()) results = await search(short)
    if (!results.length) { try { results = await wikipedia(a.query, ctx) } catch { /* nothing left */ } }
    if (!results.length) return { text: "Couldn't search the web right now (no connection, or every search engine is busy). Answer from what you know and say so.", failed: true }
    return { text: results.map((r, i) => `${i + 1}. ${r.title} — ${r.url}\n   ${r.snippet}`).join('\n') }
  },
}

export const fetchUrl: Tool<{ url: string }> = {
  spec: { name: 'fetch_url', description: 'Read a web page as text.', params: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
  title: (a) => { try { return `Read ${new URL(a.url).hostname.replace(/^www\./, '')}` } catch { return 'Read a web page' } },
  action: () => ({ kind: 'web' }),
  async run(a, ctx) {
    if (!/^https?:\/\//.test(a.url)) return { text: 'Only http and https links can be opened.', failed: true }
    const host = new URL(a.url).hostname.replace(/^www\./, '')
    ctx.unreadableHosts ??= new Set()
    if (ctx.unreadableHosts.has(host)) return { text: `Skip ${host}: it couldn't be read earlier in this task. Use a different result.`, failed: true }
    ctx.untrusted = true
    const unreadable = () => {
      ctx.unreadableHosts!.add(host)
      return { text: `This page can't be read (it's blocked for automated access or needs JavaScript). Don't retry ${host}; use another result.`, failed: true }
    }
    let res: Response
    try { res = await ctx.fetch(a.url, { signal: withTimeout(ctx.signal), headers: BROWSER_HEADERS }) } catch { return unreadable() }
    const body = await res.text()
    const html = /html/i.test(res.headers.get('content-type') ?? '')
    let text = html ? readable(body, a.url) : body
    const thin = (t: string) => t.trim().length < 200 || BOT_WALL.test(t.slice(0, 2000))
    // many sites (weather, shops) send an empty shell and fill it in with JavaScript
    if (html && thin(text) && ctx.render) {
      try { text = readable(await ctx.render(a.url, ctx.signal), a.url) } catch { /* stays thin */ }
    }
    if (thin(text)) return unreadable()
    return { text: `${a.url}\n---\n${text.slice(0, PREVIEW_CHARS)}` }
  },
}
