import { describe, expect, it } from 'vitest'
import { parseManifest } from '../src/main/plugins/manifest'
import { parseSkill, skillNameOk } from '../src/main/plugins/skills'

describe('parseManifest', () => {
  it('fills defaults for a minimal plugin', () => {
    const r = parseManifest({ id: 'hello', name: 'Hello' })
    expect(r).toEqual({ manifest: { id: 'hello', name: 'Hello', version: '0.0.0', description: '', icon: 'puzzle', permissions: { network: false }, starters: [], tools: [], mcpServers: {}, settings: [] } })
  })
  it('keeps tools, starters, MCP servers and settings', () => {
    const r = parseManifest({
      id: 'money', name: 'Money', version: '1.0.0', description: 'Rates', author: 'Frigade', icon: 'coins',
      permissions: { network: true },
      starters: [{ title: 'Convert', prompt: 'How much is 5 EUR in USD?' }],
      tools: [{ name: 'convert_currency', description: 'Convert', params: { type: 'object', properties: {} }, run: 'tools/convert.py', title: 'Converted {amount}' }],
      mcpServers: { notes: { command: 'npx', args: ['-y', 'x'], env: { A: '1' } } },
      settings: [{ key: 'API_KEY', label: 'API key', secret: true }],
    })
    if (!('manifest' in r)) throw new Error(r.error)
    expect(r.manifest.tools[0].run).toBe('tools/convert.py')
    expect(r.manifest.mcpServers.notes).toEqual({ command: 'npx', args: ['-y', 'x'], env: { A: '1' } })
    expect(r.manifest.permissions.network).toBe(true)
    expect(r.manifest.settings[0]).toEqual({ key: 'API_KEY', label: 'API key', secret: true })
  })
  it.each([
    [{ name: 'X' }, 'id'],
    [{ id: 'Bad Id', name: 'X' }, 'id'],
    [{ id: 'x' }, 'name'],
    [{ id: 'x', name: 'X', tools: [{ name: 'has space', description: 'd', run: 'a.py' }] }, 'tools[0].name'],
    [{ id: 'x', name: 'X', tools: [{ name: 'ok', description: 'd', run: '../escape.py' }] }, 'tools[0].run'],
    [{ id: 'x', name: 'X', tools: [{ name: 'ok', description: 'd', run: '/abs.py' }] }, 'tools[0].run'],
    [{ id: 'x', name: 'X', mcpServers: { a: { args: [] } } }, 'mcpServers.a.command'],
    [{ id: 'x', name: 'X', settings: [{ key: 'lower', label: 'L' }] }, 'settings[0].key'],
    ['not an object', 'object'],
  ])('rejects %j with a message naming %s', (raw, field) => {
    const r = parseManifest(raw)
    expect('error' in r && r.error).toContain(field)
  })
})

describe('parseSkill', () => {
  it('reads Agent Skills frontmatter and body', () => {
    const s = parseSkill('---\nname: plan-trip\ndescription: "Plan a trip, day by day."\n---\n# Plan\nStep 1', '/p/skills/plan-trip')
    expect(s).toEqual({ name: 'plan-trip', description: 'Plan a trip, day by day.', body: '# Plan\nStep 1', dir: '/p/skills/plan-trip' })
  })
  it('falls back to the folder name and handles folded descriptions', () => {
    const s = parseSkill('---\ndescription: >\n  Make flashcards\n  from notes.\n---\nBody', '/p/skills/flash-cards')
    expect(s).toMatchObject({ name: 'flash-cards', description: 'Make flashcards from notes.' })
  })
  it('needs a description so the model knows when to use it', () => {
    expect(parseSkill('# just a body', '/p/skills/x')).toEqual({ error: expect.stringContaining('description') })
  })
  it('skill names are lowercase words with dashes', () => {
    expect(skillNameOk('weekly-report')).toBe(true)
    expect(skillNameOk('Weekly Report')).toBe(false)
  })
})
