/** files: what was in the files attached to it, kept even when the message itself is folded into the recap */
type Msg = { role: 'user' | 'assistant'; content: string; files?: string }
const withFiles = <M extends Msg>({ files, ...m }: M) => ({ ...m, content: files ? `${m.content}\n${files}` : m.content }) as Omit<M, 'files'>

/** ~4 characters per token. 32k-token context: room for the prompt, tools, this turn's work and the answer. */
export const HISTORY_CHARS = 40_000
export const TURN_TOOL_CHARS = 60_000

const line = (s: string, n: number) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t }

/**
 * Long chats would overflow the model's memory, and the engine would then silently drop the oldest
 * messages mid-answer. Instead keep the newest messages whole and fold older ones into a short recap.
 */
export function fitHistory<M extends Msg>(history: M[], budget = HISTORY_CHARS): Omit<M, 'files'>[] {
  const size = (ms: Msg[]) => ms.reduce((n, m) => n + m.content.length + (m.files?.length ?? 0), 0)
  if (size(history) <= budget) return history.map(withFiles)
  // keep whole user→assistant pairs from the end; the last pair always stays
  let start = history.length
  while (start > 0) {
    const from = Math.max(0, start - 2)
    if (start < history.length && size(history.slice(from)) > budget * 0.8) break
    start = from
  }
  // the kept part must start with the user (an unanswered message can shift the pairs)
  while (start < history.length - 2 && history[start].role !== 'user') start++
  if (start === 0) return history.map(withFiles)
  const older = history.slice(0, start)
  const recap = older.map((m) => (m.role === 'user' ? `- The user asked: ${line(m.content, 160)}` : `- You answered: ${line(m.content, 120)}`))
  const text = ['[Earlier in this chat, shortened to save memory]', ...recap].join('\n').slice(0, Math.floor(budget * 0.2))
  // files shared earlier ("the menu") are what follow-ups ask about: keep them, the newest first, while they fit
  const files: string[] = []
  let room = Math.floor(budget * 0.4)
  for (const f of older.map((m) => m.files).filter((f): f is string => !!f).reverse()) {
    if (f.length > room) break
    files.unshift(f); room -= f.length
  }
  const proto = withFiles(older[0])
  return [
    { ...proto, role: 'user', content: [text, ...files].join('\n') },
    { ...proto, role: 'assistant', content: 'Got it, I have that context.' },
    ...history.slice(start).map(withFiles),
  ]
}

/** One task's tool output: once it has read a lot, later results are cut so the newest steps still fit. */
export class ToolBudget {
  private used = 0
  /** floor: even late results keep this much, so the model still sees what happened */
  constructor(private limit = TURN_TOOL_CHARS, private floor = 1500) {}
  take(text: string): string {
    const left = this.limit - this.used
    const out = text.length <= Math.max(left, this.floor) ? text
      : `${text.slice(0, this.floor)}\n… [shortened: this task has already read a lot. Ask for only what you need, e.g. print fewer rows.]`
    this.used += out.length
    return out
  }
}
