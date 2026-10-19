import { readdirSync } from 'node:fs'
import type { Tool } from '../agent/tool'
import type { NewSkill } from '../../shared/plugins'
import { slug, skillNameOk, type Skill } from './skills'

const nameOf = (n: unknown) => { const s = String(n ?? ''); return skillNameOk(s) ? s : slug(s) }

export type SkillSource = {
  skills(): (Skill & { pluginName: string })[]
  findSkill(name: string): Skill | undefined
  saveSkill(s: NewSkill): { ok: true; name: string } | { ok: false; error: string }
  onSaved?(): void
}

const filesIn = (dir: string) => { try { return readdirSync(dir, { recursive: true }).map(String).filter((f) => f !== 'SKILL.md' && !f.startsWith('.')) } catch { return [] } }

/** Read a skill's full instructions (only names and one-line descriptions are in the system prompt). */
export const useSkillTool = (src: SkillSource): Tool<{ name: string }> => ({
  spec: {
    name: 'use_skill',
    description: 'Get the step-by-step instructions of one of your skills (listed in your instructions) before doing that kind of task.',
    params: { type: 'object', properties: { name: { type: 'string', description: 'The skill name, e.g. plan-trip' } }, required: ['name'] },
  },
  title: (a) => `Used the ${String(a.name ?? '').replace(/-/g, ' ')} skill`,
  action: () => ({ kind: 'run' }),
  async run(a) {
    const s = src.findSkill(String(a.name ?? '').replace(/^\//, ''))
    if (!s) return { text: `There's no skill called “${a.name}”. Skills you have: ${src.skills().map((x) => x.name).join(', ') || 'none'}.`, failed: true }
    const files = filesIn(s.dir)
    return { text: `${s.body}\n\n(Skill folder: ${s.dir}${files.length ? `; files: ${files.slice(0, 30).join(', ')}` : ''})` }
  },
})

/** Hob writes down a routine the user taught it. Always asks: it changes how Hob behaves later. */
export const saveSkillTool = (src: SkillSource): Tool<{ name: string; description: string; instructions: string }> => ({
  spec: {
    name: 'save_skill',
    description: 'Save reusable instructions as a skill the user can run later with /name. Only when the user asks you to remember how to do something.',
    params: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short name, lowercase words with dashes, e.g. weekly-report' },
        description: { type: 'string', description: 'One sentence: when to use this skill' },
        instructions: { type: 'string', description: 'Clear step-by-step instructions in Markdown' },
      },
      required: ['name', 'description', 'instructions'],
    },
  },
  title: (a) => `Saved the “${nameOf(a.name)}” skill`,
  action: () => ({ kind: 'app', ask: true }),
  ask: (a) => `Save a skill called “${nameOf(a.name)}”? You can use it later by typing /${nameOf(a.name)}.`,
  async run(a) {
    const r = src.saveSkill({ name: String(a.name ?? ''), description: String(a.description ?? ''), instructions: String(a.instructions ?? '') })
    if (!r.ok) return { text: r.error, failed: true }
    src.onSaved?.()
    return { text: `Saved. The user can run it with /${r.name}, and you'll see it in your skills list.`, title: `Saved the “${r.name}” skill` }
  },
})
