import { readdirSync } from 'node:fs'
import type { Tool } from '../agent/tool'
import type { NewSkill } from '../../shared/plugins'
import { slug, skillNameOk, type Skill } from './skills'

const nameOf = (n: unknown) => { const s = String(n ?? ''); return skillNameOk(s) ? s : slug(s) }

export type SkillSource = {
  skills(): (Skill & { pluginName: string })[]
  findSkill(name: string): Skill | undefined
  saveSkill(s: NewSkill, o?: { replace?: boolean }): { ok: true; name: string } | { ok: false; error: string }
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

type SaveArgs = { name: string; description: string; instructions: string; files?: Record<string, string>; network?: boolean; replace?: boolean }

const filesOf = (a: SaveArgs): Record<string, string> =>
  a.files && typeof a.files === 'object' && !Array.isArray(a.files) ? Object.fromEntries(Object.entries(a.files).map(([k, v]) => [k, String(v ?? '')])) : {}

/** the steps must say how to run the scripts; small models leave that out */
function withRunLine(name: string, instructions: string, files: Record<string, string>): string {
  const missing = Object.keys(files).filter((f) => f.endsWith('.py') && !instructions.includes(`${name}/${f}`))
  if (!missing.length) return instructions
  return `${instructions.trim()}\n\nScripts in this skill: run them with run_python, passing ${missing.map((f) => `script "${name}/${f}"`).join(' or ')} and the inputs as args.`
}

/** Hob writes down a routine the user taught it, with the code that worked. Always asks: it changes how Hob behaves later. */
export const saveSkillTool = (src: SkillSource): Tool<SaveArgs> => ({
  spec: {
    name: 'save_skill',
    description: 'Save how to do a task as a skill the user can run later with /name: steps, plus the code that worked as script files. Only when the user asks.',
    params: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short name, lowercase words with dashes, e.g. weekly-report' },
        description: { type: 'string', description: 'One sentence: when to use this skill' },
        instructions: { type: 'string', description: 'Clear step-by-step instructions in Markdown. Say which script to run and what to pass it.' },
        files: { type: 'object', description: 'Scripts and data to keep with the skill: file name → contents, e.g. {"make_report.py": "..."}. Use code that already worked in this chat. Scripts get their inputs from sys.argv and save results in the current folder.', additionalProperties: { type: 'string' } },
        network: { type: 'boolean', description: 'true only if the scripts need the internet' },
        replace: { type: 'boolean', description: 'true to update an existing skill with this name' },
      },
      required: ['name', 'description', 'instructions'],
    },
  },
  title: (a) => `Saved the “${nameOf(a.name)}” skill`,
  // a web page read in this message could be steering the model; a skill would keep that going in later chats
  refuse: (_a, ctx) => (ctx.untrusted ? "Hob can't save skills after reading web pages in the same message. Tell the user to ask again in a new message." : undefined),
  action: () => ({ kind: 'app', ask: true }),
  ask: (a) => {
    const n = nameOf(a.name)
    const what = a.replace && src.findSkill(n) ? `Replace the “${n}” skill?` : `Save a skill called “${n}”?`
    return `${what} You can use it later by typing /${n}.${a.network ? ' Its scripts use the internet.' : ''}`
  },
  askDetail: (a) => {
    const files = filesOf(a)
    return [`${String(a.description ?? '').trim()}`, '', String(a.instructions ?? '').trim(),
      ...Object.entries(files).map(([f, text]) => `\n--- ${f} ---\n${text.trim()}`)].join('\n')
  },
  async run(a) {
    const name = nameOf(a.name)
    const files = filesOf(a)
    const r = src.saveSkill({ name, description: String(a.description ?? ''), instructions: withRunLine(name, String(a.instructions ?? ''), files), files, network: a.network === true }, { replace: a.replace === true })
    if (!r.ok) return { text: r.error, failed: true }
    src.onSaved?.()
    return { text: `Saved. The user can run it with /${r.name}, and you'll see it in your skills list.`, title: `Saved the “${r.name}” skill` }
  },
})
