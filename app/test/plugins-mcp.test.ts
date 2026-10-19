import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { McpClient } from '../src/main/plugins/mcp'

const fixture = join(import.meta.dirname, 'fixtures/mcp-server.mjs')
let client: McpClient | undefined
afterEach(() => client?.close())

it('starts a stdio server, lists every page of tools and calls one', async () => {
  client = new McpClient({ command: process.execPath, args: [fixture], env: { FIXTURE_KEY: 'k1', ELECTRON_RUN_AS_NODE: '1' } })
  const tools = await client.listTools()
  expect(tools.map((t) => t.name)).toEqual(['echo', 'delete-note'])
  expect(tools[1].annotations?.destructiveHint).toBe(true)
  const r = await client.call('echo', { text: 'hi' }, new AbortController().signal)
  expect(r.isError).toBeFalsy()
  expect(r.content[0]).toEqual({ type: 'text', text: 'echo: hi k1' })
  expect(r.content[1]).toMatchObject({ type: 'image', mimeType: 'image/png' })
})

it('reports a server that fails to start in plain words', async () => {
  client = new McpClient({ command: '/no/such/program' })
  await expect(client.listTools()).rejects.toThrow(/couldn't start/i)
})

it('a server that exits is restarted on the next call', async () => {
  client = new McpClient({ command: process.execPath, args: [fixture], env: { ELECTRON_RUN_AS_NODE: '1' } })
  await client.listTools()
  client.kill()
  await new Promise((r) => setTimeout(r, 100))
  expect((await client.listTools()).length).toBe(2)
})

it('close() rejects calls in flight instead of leaving them hanging', async () => {
  client = new McpClient({ command: process.execPath, args: ['-e', `require('readline').createInterface({input:process.stdin}).on('line',l=>{const m=JSON.parse(l);if(m.method==='initialize')process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{}})+'\\n')})`], env: { ELECTRON_RUN_AS_NODE: '1' } })
  const p = client.call('slow', {}, new AbortController().signal)
  setTimeout(() => client!.close(), 300)
  await expect(p).rejects.toThrow()
})

it('Stop cancels a call that is still waiting for the server to start', async () => {
  client = new McpClient({ command: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], env: { ELECTRON_RUN_AS_NODE: '1' } })
  const ac = new AbortController()
  setTimeout(() => ac.abort(), 200)
  const t0 = Date.now()
  await expect(client.call('x', {}, ac.signal)).rejects.toThrow(/Stopped/)
  expect(Date.now() - t0).toBeLessThan(3000)
})
