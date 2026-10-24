import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const html = fs.readFileSync('content/home.html', 'utf8')
assert(html.includes('An easier way to use AI'))
assert(!/Design comparison|headline-study|mascot-study|hob-palettes|noindex|Connected tools share information/.test(html))
assert(html.includes('https://hob.chat/'))
assert(html.includes('sandbox="allow-scripts"'))
// link previews: a 1200×630 image that ships with the site
const og = html.match(/property="og:image" content="https:\/\/hob\.chat(\/[^"]+)"/)?.[1]
assert(og && fs.existsSync(path.join('public', og)), 'og:image must point at a file in public/')
assert(html.includes('name="twitter:card" content="summary_large_image"'))
const files = new Set()
for (const [, url] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  if (/^(https?:|#|data:|mailto:)/.test(url)) continue
  assert(url.startsWith('/'), 'production assets must use root-relative URLs: ' + url)
  const file = path.join('public', url.split('?')[0])
  assert(fs.existsSync(file), 'missing asset: ' + file)
  files.add(file)
}
for (const file of files) {
  if (!file.endsWith('.css')) continue
  for (const [, url] of fs.readFileSync(file, 'utf8').matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
    if (/^(data:|#)/.test(url)) continue
    assert(fs.existsSync(path.resolve(path.dirname(file), url)), 'missing CSS asset: ' + url)
  }
}
const demo = fs.readFileSync('public/marketing/hero-app/index.html', 'utf8')
assert(demo.includes('Weekend in Portland') && demo.includes('Client proposal draft'))
assert(!demo.includes('Lease terms review'))
assert(demo.includes('data:image/png;base64,') && demo.includes('data:font/ttf;base64,'))
assert(!/<(?:link|script)[^>]+(?:src|href)=/.test(demo), 'demo stays self-contained')
console.log(`PASS: production copy, metadata, ${files.size} asset references, and self-contained demo.`)
