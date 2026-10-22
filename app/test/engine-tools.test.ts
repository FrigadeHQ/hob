import { describe, expect, it } from 'vitest'
import { dropSkipped, engineSchema, STEP_LIMIT_MESSAGE, toolFunctions } from '../src/engine/tools'

const specs = [{ name: 'list_files', description: 'List', params: { type: 'object', properties: {} } }]

it('forwards each call to the main process with the tool name and args', async () => {
  const seen: unknown[] = []
  const fns = toolFunctions(specs, async (name, args) => { seen.push([name, args]); return 'ok' })
  expect(fns.list_files.description).toBe('List')
  expect(await fns.list_files.handler({ a: 1 })).toBe('ok')
  expect(seen).toEqual([['list_files', { a: 1 }]])
})

it("a call garbled with the model's own markup is sent back to the model, never run", async () => {
  // Gemma 4 26B once wrote two calls into one: path = '"}<tool_call|><|tool_call>call:list_files{{'
  let calls = 0
  const fns = toolFunctions(specs, async () => { calls++; return 'ok' })
  const r = await fns.list_files.handler({ path: '"}<tool_call|><|tool_call>call:list_files{{' })
  expect(calls).toBe(0)
  expect(r).toMatch(/garbled.*list_files again/i)
  expect(await fns.list_files.handler({ path: 'notes <b>bold</b>.txt' })).toBe('ok')
})

it('stops forwarding after the step limit', async () => {
  let calls = 0
  const fns = toolFunctions(specs, async () => { calls++; return 'ok' }, 2)
  await fns.list_files.handler({})
  await fns.list_files.handler({})
  expect(await fns.list_files.handler({})).toBe(STEP_LIMIT_MESSAGE)
  expect(calls).toBe(2)
})

describe('engineSchema: any MCP tool schema becomes one the local grammar can follow', () => {
  it('anyOf becomes oneOf; type lists and nested objects survive', () => {
    expect(engineSchema({ type: 'object', properties: { repo: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }], description: 'd' } }, required: ['repo'] }))
      .toEqual({ type: 'object', properties: { repo: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }], description: 'd' } }, required: ['repo'] })
  })
  it('allOf merges, missing type is inferred, unknown formats and keywords are dropped', () => {
    expect(engineSchema({ $schema: 'x', properties: { when: { type: 'string', format: 'uri' }, n: { allOf: [{ type: 'integer' }, { minimum: 1 }] } }, required: ['when', 'n'], additionalProperties: false }))
      .toEqual({ type: 'object', properties: { when: { type: 'string' }, n: { type: 'integer' } }, required: ['when', 'n'] })
  })
  it('an empty schema accepts simple values; nullable is a null option; a whole schema of {} is an empty object', () => {
    expect(engineSchema({ type: 'object', properties: { x: {}, y: { type: 'string', nullable: true } }, required: ['x', 'y'] }))
      .toEqual({ type: 'object', properties: { x: { type: ['string', 'number', 'boolean', 'null'] }, y: { type: ['string', 'null'] } }, required: ['x', 'y'] })
    expect(engineSchema({})).toEqual({ type: 'object', properties: {} })
  })
  it('keeps enums, consts, dates and refs to definitions', () => {
    const s = { type: 'object', properties: { d: { type: 'string', format: 'date' }, e: { enum: ['a', 'b'] }, c: { const: 1 }, r: { $ref: '#/$defs/P' } }, required: ['d', 'e', 'c', 'r'], $defs: { P: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] } } }
    expect(engineSchema(s)).toEqual(s)
  })
  it('optional arguments may be null (the grammar writes every property), and nulls are dropped before the call', async () => {
    const params = { type: 'object', properties: { path: { type: 'string' }, head: { type: 'number', description: 'first N lines' }, opts: { type: 'object', properties: { deep: { type: 'boolean' } } } }, required: ['path'] }
    expect(engineSchema(params)).toEqual({
      type: 'object', required: ['path'],
      properties: { path: { type: 'string' }, head: { description: 'first N lines', oneOf: [{ type: 'number' }, { type: 'null' }] }, opts: { oneOf: [{ type: 'object', properties: { deep: { oneOf: [{ type: 'boolean' }, { type: 'null' }] } } }, { type: 'null' }] } },
    })
    const seen: unknown[] = []
    const fns = toolFunctions([{ name: 'read', description: 'r', params }], async (_n, a) => { seen.push(a); return 'ok' })
    await fns.read.handler({ path: 'a.txt', head: null, opts: { deep: null } })
    expect(seen).toEqual([{ path: 'a.txt', opts: {} }])
  })
})

describe('engineSchema review fixes', () => {
  it('a type list with object or array becomes oneOf, so the grammar can build it', () => {
    expect(engineSchema({ type: 'object', properties: { tags: { type: ['array', 'null'], items: { type: 'string' } } }, required: ['tags'] }).properties)
      .toEqual({ tags: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }] } })
    expect(engineSchema({ type: 'object', properties: { o: { type: 'object', nullable: true, properties: { a: { type: 'string' } }, required: ['a'] } }, required: ['o'] }).properties)
      .toEqual({ o: { oneOf: [{ type: 'object', properties: { a: { type: 'string' } }, required: ['a'] }, { type: 'null' }] } })
  })
  it('free-form objects stay free-form', () => {
    const p = engineSchema({ type: 'object', properties: { meta: { type: 'object', additionalProperties: true }, bag: { type: 'object' } }, required: ['meta', 'bag'] }).properties as Record<string, unknown>
    expect(p.meta).toEqual({ type: 'object', properties: {}, additionalProperties: true })
    expect(p.bag).toEqual({ type: 'object', properties: {}, additionalProperties: true })
  })
  it('drops the nulls Hob added inside arrays, choices and refs; keeps nulls the tool itself allows', () => {
    const schema = {
      type: 'object', required: ['items'],
      properties: {
        items: { type: 'array', items: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } }, required: ['a'] } },
        assignee: { type: ['string', 'null'] },
        pick: { anyOf: [{ type: 'object', properties: { x: { type: 'string' }, y: { type: 'number' } }, required: ['x'] }, { type: 'string' }] },
        ref: { $ref: '#/$defs/R' },
      },
      $defs: { R: { type: 'object', properties: { r: { type: 'string' } } } },
    }
    expect(dropSkipped({ items: [{ a: 'x', b: null }], assignee: null, pick: { x: '1', y: null }, ref: { r: null } }, schema))
      .toEqual({ items: [{ a: 'x' }], assignee: null, pick: { x: '1' }, ref: {} })
  })
})
