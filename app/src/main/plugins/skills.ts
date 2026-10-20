import { basename } from 'node:path'

/** Instructions for one kind of task, in the Agent Skills format (SKILL.md: frontmatter + Markdown). */
/** network: its scripts may use the internet (frontmatter `network: true`; plugins must also ask for it in their manifest) */
export type Skill = { name: string; description: string; body: string; dir: string; network?: boolean }

const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/
export const skillNameOk = (n: string) => NAME.test(n)
/** "Weekly report!" → "weekly-report" */
export const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)

const unquote = (v: string) => (/^(["']).*\1$/.test(v) ? v.slice(1, -1) : v)

/** The small YAML subset skills use: `key: value`, quoted values, and folded/literal blocks (`>` / `|`). */
function frontmatter(text: string): { meta: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!m) return { meta: {}, body: text }
  const meta: Record<string, string> = {}
  const lines = m[1].split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(lines[i])
    if (!kv) continue
    let v = kv[2].trim()
    if (v === '>' || v === '|' || v === '>-' || v === '|-') {
      const block: string[] = []
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || !lines[i + 1].trim())) block.push(lines[++i].trim())
      v = block.join(v.startsWith('>') ? ' ' : '\n').trim()
    }
    meta[kv[1]] = unquote(v)
  }
  return { meta, body: text.slice(m[0].length) }
}

export function parseSkill(text: string, dir: string): Skill | { error: string } {
  const { meta, body } = frontmatter(text)
  const name = meta.name || basename(dir)
  if (!skillNameOk(name)) return { error: `${basename(dir)}/SKILL.md: name must be lowercase words with dashes, like "plan-trip"` }
  if (!meta.description) return { error: `${basename(dir)}/SKILL.md: add a description in the frontmatter so Hob knows when to use it` }
  return { name, description: meta.description, body: body.trim(), dir, ...(meta.network === 'true' ? { network: true } : {}) }
}

export const skillFile = (s: { name: string; description: string; instructions: string; network?: boolean }) =>
  `---\nname: ${s.name}\ndescription: ${JSON.stringify(s.description.replace(/\s+/g, ' ').trim())}\n${s.network ? 'network: true\n' : ''}---\n${s.instructions.trim()}\n`

const FILE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}\.(py|md|txt|json|csv)$/
export const MAX_SKILL_FILES = 10
export const MAX_SKILL_FILE_BYTES = 100_000
/** Why these files can't be saved with a skill; undefined if they can. Plain text next to SKILL.md only. */
export function skillFilesProblem(files: Record<string, string>): string | undefined {
  const names = Object.keys(files)
  if (names.length > MAX_SKILL_FILES) return `A skill can keep up to ${MAX_SKILL_FILES} files.`
  for (const n of names) {
    if (n === 'SKILL.md' || !FILE.test(n)) return `“${n}” can't be saved with a skill: use a plain file name ending in .py, .md, .txt, .json or .csv.`
    if (Buffer.byteLength(String(files[n])) > MAX_SKILL_FILE_BYTES) return `“${n}” is too big to keep with a skill (100 KB at most).`
  }
  return undefined
}
