// Minimal MCP server over stdio for tests: two tools, one of them marked destructive.
import { createInterface } from 'node:readline'
const send = (m) => process.stdout.write(JSON.stringify(m) + '\n')
createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line)
  if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } } })
  else if (m.method === 'tools/list') {
    // two pages, to exercise the cursor
    if (!m.params?.cursor) send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'echo', description: 'Echo text back', inputSchema: { type: 'object', properties: { text: { type: 'string' } } }, annotations: { readOnlyHint: true } }], nextCursor: 'p2' } })
    else send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'delete-note', title: 'Delete a note', description: 'Delete a note', inputSchema: { type: 'object', properties: { id: { type: 'string' } } }, annotations: { destructiveHint: true } }] } })
  } else if (m.method === 'tools/call') {
    if (m.params.name === 'echo') send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: `echo: ${m.params.arguments.text} ${process.env.FIXTURE_KEY ?? ''}`.trim() }, { type: 'image', data: Buffer.from('png!').toString('base64'), mimeType: 'image/png' }] } })
    else send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'no such note' }], isError: true } })
  } else if (m.id !== undefined) send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'nope' } })
})
