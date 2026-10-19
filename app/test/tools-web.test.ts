import { expect, it } from 'vitest'
import { fetchUrl, htmlToText, onTopic, readable, webSearch } from '../src/main/tools/web'

it('turns HTML into readable text', () => {
  const t = htmlToText('<html><head><style>x{}</style><script>alert(1)</script></head><body><h1>Title</h1><p>One &amp; two</p><ul><li>a</li><li>b</li></ul></body></html>')
  expect(t).toBe('Title\nOne & two\na\nb')
})

const ctx = (o: Record<string, unknown>) => ({ chatDir: '/c', grants: [], signal: new AbortController().signal, untrusted: false, webAccess: true, runTmp: '/t', ...o }) as never

it('web_search uses the local search engine and marks the turn as having web content', async () => {
  const c = ctx({ search: async () => [{ title: 'Lisbon weather', url: 'https://w.com', snippet: 'Sunny' }], fetch: async () => { throw new Error('no network') } })
  const out = await webSearch.run({ query: 'lisbon weather' }, c)
  expect(out.text).toContain('Lisbon weather — https://w.com')
  expect((c as { untrusted: boolean }).untrusted).toBe(true)
})

it('falls back to Wikipedia when the search engine fails or finds nothing', async () => {
  const wiki = { query: { search: [{ title: 'Compound interest', snippet: 'Interest on <span>interest</span>' }] } }
  const c = ctx({ search: async () => { throw new Error('down') }, fetch: async (u: string) => { expect(u).toContain('wikipedia.org/w/api.php'); return new Response(JSON.stringify(wiki)) } })
  const out = await webSearch.run({ query: 'compound interest' }, c)
  expect(out.text).toContain('Compound interest — https://en.wikipedia.org/wiki/Compound_interest')
  expect(out.text).toContain('Interest on interest')
})

it('says so plainly when nothing works', async () => {
  const c = ctx({ search: async () => [], fetch: async () => { throw new Error('offline') } })
  expect((await webSearch.run({ query: 'x' }, c)).text).toMatch(/couldn't search/i)
})

it('reads the article text of a page, not the menus around it', () => {
  const html = `<html><head><title>Guide</title></head><body><nav>Home | About | Contact</nav>
    <article><h1>How to remove a wine stain</h1>${'<p>Blot the stain gently with a clean cloth, then apply cold water and salt to lift it out of the fabric.</p>'.repeat(6)}</article>
    <footer>© 2026 Cookie policy</footer></body></html>`
  const t = readable(html, 'https://x.com')
  expect(t).toContain('Blot the stain gently')
  expect(t).not.toContain('Cookie policy')
})

it('fetch_url uses the readable text for HTML pages', async () => {
  const html = `<html><body><nav>Menu</nav><article>${'<p>Real content sentence that is long enough to count as an article paragraph.</p>'.repeat(6)}</article></body></html>`
  const c = ctx({ fetch: async () => new Response(html, { headers: { 'content-type': 'text/html' } }) })
  const out = await fetchUrl.run({ url: 'https://x.com/a' }, c)
  expect(out.text).toContain('Real content sentence')
  expect(out.text).not.toContain('Menu')
})

it("a page behind a bot check or with no readable text is reported as unreadable, and that site is skipped after", async () => {
  let fetches = 0
  const c = ctx({ fetch: async () => { fetches++; return new Response('<html><title>Just a moment...</title><body>Checking your browser</body></html>', { status: 403, headers: { 'content-type': 'text/html' } }) } })
  const first = await fetchUrl.run({ url: 'https://weather.com/a' }, c)
  expect(first.failed).toBe(true)
  expect(first.text).toMatch(/can't be read/i)
  const second = await fetchUrl.run({ url: 'https://weather.com/b' }, c)
  expect(second.text).toMatch(/skip weather\.com/i)
  expect(fetches).toBe(1)
})

it('asks for pages like a normal browser does', async () => {
  let headers: Headers | undefined
  const html = `<html><body><article>${'<p>Plenty of readable article text in this paragraph for the reader view.</p>'.repeat(6)}</article></body></html>`
  const c = ctx({ fetch: async (_u: string, init: RequestInit) => { headers = new Headers(init.headers); return new Response(html, { headers: { 'content-type': 'text/html' } }) } })
  await fetchUrl.run({ url: 'https://x.com/a' }, c)
  expect(headers?.get('user-agent')).toMatch(/Chrome\/\d+/)
  expect(headers?.get('accept-language')).toBeTruthy()
})

it('pages that only fill in with JavaScript are read through a hidden browser', async () => {
  const shell = '<html><body><div id="app"></div><script src="app.js"></script></body></html>'
  const rendered = `<html><body><article>${'<p>Lisbon tomorrow: sunny, high of 24 degrees and a light breeze from the west all day.</p>'.repeat(5)}</article></body></html>`
  const c = ctx({
    fetch: async () => new Response(shell, { headers: { 'content-type': 'text/html' } }),
    render: async (url: string) => { expect(url).toBe('https://weather.example/lisbon'); return rendered },
  })
  const out = await fetchUrl.run({ url: 'https://weather.example/lisbon' }, c)
  expect(out.failed).toBeFalsy()
  expect(out.text).toContain('high of 24 degrees')
})

it('get_weather looks up the place and returns a readable daily forecast (Open-Meteo)', async () => {
  const { getWeather } = await import('../src/main/tools/weather')
  const urls: string[] = []
  const c = ctx({ fetch: async (u: string) => {
    urls.push(u)
    if (u.includes('geocoding-api.open-meteo.com')) return new Response(JSON.stringify({ results: [{ name: 'Lisbon', country: 'Portugal', latitude: 38.72, longitude: -9.14 }] }))
    return new Response(JSON.stringify({ daily: { time: ['2026-10-16', '2026-10-17'], weather_code: [0, 61], temperature_2m_max: [24.1, 21.4], temperature_2m_min: [16.2, 15.0], precipitation_probability_max: [0, 70], wind_speed_10m_max: [12.3, 25.0] }, daily_units: { wind_speed_10m_max: 'km/h' } }))
  } })
  const out = await getWeather.run({ location: 'Lisbon' }, c)
  expect(urls[0]).toContain('name=Lisbon')
  expect(urls[1]).toContain('latitude=38.72')
  expect(out.text).toContain('Lisbon, Portugal')
  expect(out.text).toContain('2026-10-16: Clear sky, 16–24°C, 0% chance of rain, wind up to 12 km/h')
  expect(out.text).toContain('2026-10-17: Rain, 15–21°C, 70% chance of rain')
  expect(getWeather.title({ location: 'Lisbon' })).toBe('Checked the weather in Lisbon')
})

it('get_weather says plainly when the place is unknown', async () => {
  const { getWeather } = await import('../src/main/tools/weather')
  const c = ctx({ fetch: async () => new Response(JSON.stringify({})) })
  const out = await getWeather.run({ location: 'Nowhereville' }, c)
  expect(out.failed).toBe(true)
  expect(out.text).toMatch(/couldn't find/i)
})

it('drops results that share no word with the question (a search engine sending decoys), keeps the real ones', async () => {
  const c = ctx({
    search: async () => [
      { title: 'Time in Manila, Philippines now', url: 'https://time.is/Manila', snippet: 'Exact time now' },
      { title: 'Frigade: The AI-native product adoption platform', url: 'https://frigade.com/', snippet: 'AI digital adoption' },
      { title: 'Track a package', url: 'https://ups.com/track', snippet: 'Where is my package' },
      { title: 'About us', url: 'https://frigade.com/about', snippet: 'Our approach' },
    ],
    fetch: async () => { throw new Error('no network') },
  })
  const out = await webSearch.run({ query: 'What is Frigade?' }, c)
  expect(out.text).toContain('frigade.com/')
  expect(out.text).toContain('frigade.com/about')
  expect(out.text).not.toMatch(/Manila|package/)
  expect(out.text).toMatch(/^1\. Frigade/)
})

it('when every result is off-topic, searches again with just the key words', async () => {
  const queries: string[] = []
  const c = ctx({
    search: async (q: string) => { queries.push(q); return q === 'frigade' ? [{ title: 'Frigade', url: 'https://frigade.com/', snippet: 'Product adoption' }] : [{ title: 'UPS tracking', url: 'https://ups.com', snippet: 'Track' }] },
    fetch: async () => { throw new Error('no network') },
  })
  const out = await webSearch.run({ query: 'what is frigade' }, c)
  expect(queries).toEqual(['what is frigade', 'frigade'])
  expect(out.text).toContain('frigade.com')
})

it('keeps results for questions made only of common words', async () => {
  const c = ctx({ search: async () => [{ title: 'Result', url: 'https://x.com', snippet: 's' }], fetch: async () => { throw new Error('no') } })
  expect((await webSearch.run({ query: 'what is it' }, c)).text).toContain('x.com')
})

it('a result only a decoy-prone engine found must mention every key word (stems count)', () => {
  const r = (title: string, strict?: boolean) => ({ title, url: 'https://x.com', snippet: '', ...(strict ? { strict } : {}) })
  const kept = onTopic([r('FOUNDED | Cambridge Dictionary', true), r('Frigade was founded in 2021', true), r('Frigade on LinkedIn'), r('Hiking near Lisbon: 10 trails', true)], 'who founded frigade')
  expect(kept.map((x) => x.title)).toEqual(['Frigade was founded in 2021', 'Frigade on LinkedIn'])
  expect(onTopic([r('Hiking near Lisbon: 10 trails', true), r('BEST | Merriam-Webster', true)], 'best hikes near lisbon').map((x) => x.title)).toEqual(['Hiking near Lisbon: 10 trails'])
})
