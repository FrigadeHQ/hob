import { describe, expect, it } from 'vitest'
import { argumentText, declarationText, parseCall } from '../src/engine/gemma'

const Q = '<|"|>'

describe("Gemma 4's own tool-call format", () => {
  it('reads a call the way Gemma writes it', () => {
    expect(parseCall(`move_file{from:${Q}groceries.txt${Q},to:${Q}shopping.txt${Q}}`)).toEqual({ name: 'move_file', args: { from: 'groceries.txt', to: 'shopping.txt' } })
    expect(parseCall('list_files{}')).toEqual({ name: 'list_files', args: {} })
    // numbers, true/false/null, lists and nested objects; text keeps commas, braces and quotes
    expect(parseCall(`make_chart{n:3,ok:true,x:null,tags:[${Q}a, b${Q},2],opts:{title:${Q}Sales {2026} "Q1"${Q}}}`))
      .toEqual({ name: 'make_chart', args: { n: 3, ok: true, x: null, tags: ['a, b', 2], opts: { title: 'Sales {2026} "Q1"' } } })
  })
  it('keeps code with newlines and quotes whole', () => {
    const code = 'import os\nprint("hi", {"a": 1})\n'
    expect(parseCall(`run_python{code:${Q}${code}${Q}}`)?.args).toEqual({ code })
  })
  it('a call cut off before its end keeps what it has', () => {
    expect(parseCall(`write_file{path:${Q}a.txt${Q},content:${Q}hello`)).toEqual({ name: 'write_file', args: { path: 'a.txt', content: 'hello' } })
  })
  it('not a call', () => {
    expect(parseCall('')).toBeUndefined()
    expect(parseCall('{from:1}')).toBeUndefined()
  })
  it('writes arguments and declarations the way Gemma reads them', () => {
    expect(argumentText({ from: 'a.txt', n: 2, list: ['x'], o: { k: true } })).toBe(`{from:${Q}a.txt${Q},list:[${Q}x${Q}],n:2,o:{k:true}}`)
    expect(declarationText('move_file', { description: 'Move a file.', params: { type: 'object', properties: { from: { type: 'string', description: 'Where it is' }, to: { type: 'string' } }, required: ['from', 'to'] } }))
      .toBe(`declaration:move_file{description:${Q}Move a file.${Q},parameters:{properties:{from:{description:${Q}Where it is${Q},type:${Q}STRING${Q}},to:{type:${Q}STRING${Q}}},required:[${Q}from${Q},${Q}to${Q}],type:${Q}OBJECT${Q}}}`)
  })
  it('round trip: what Hob writes, Gemma-style, reads back the same', () => {
    const args = { code: 'x = {"a": [1, 2]}\nprint(x)', network: false, files: ['a b.csv'] }
    expect(parseCall(`run_python${argumentText(args)}`)?.args).toEqual(args)
  })
})
