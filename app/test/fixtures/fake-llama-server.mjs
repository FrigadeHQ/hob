// Stands in for llama.cpp's llama-server in tests: same flags, /health and /v1/chat/completions.
import { createServer } from 'node:http'
const arg = (name) => { const i = process.argv.indexOf(name); return i === -1 ? undefined : process.argv[i + 1] }
if (process.env.FAKE_LLAMA_FAIL_GPU && arg('-ngl') !== '0') { console.error('no vulkan'); process.exit(1) }
const key = arg('--api-key')
const server = createServer((req, res) => {
  if (req.headers.authorization !== `Bearer ${key}`) { res.writeHead(401).end(); return }
  if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}'); return }
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', async () => {
    if (process.env.FAKE_LLAMA_SLOW) await new Promise((r) => setTimeout(r, Number(process.env.FAKE_LLAMA_SLOW)))
    const msg = JSON.parse(body).messages[0].content
    const img = msg.find((p) => p.type === 'image_url').image_url.url
    const q = msg.find((p) => p.type === 'text').text
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: `saw ${img.slice(0, 22)} (${img.length} chars) for: ${q} gpu=${arg('-ngl')}` } }] }))
  })
})
server.listen(Number(arg('--port')), arg('--host'))
