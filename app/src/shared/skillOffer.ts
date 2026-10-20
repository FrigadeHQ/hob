import type { Step } from './agent'

type Msg = { role: 'user' | 'assistant'; content: string; steps: Step[] }

/** tools whose work is worth keeping as a skill's script */
const CODE = new Set(['run_python'])

/**
 * Which reply gets the "Save as a skill" offer: the first one in the chat that did real work with code
 * (3+ steps, all worked), unless it ran a skill already or the chat saved one. -1 for none.
 * Only the first such reply, and only while it's the latest: the offer shows once per chat, never on old replies.
 */
export function skillOffer(messages: Msg[], skills: string[]): number {
  if (messages.some((m) => m.steps.some((s) => s.tool === 'save_skill'))) return -1
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role !== 'assistant') continue
    const done = m.steps.filter((s) => s.status === 'done')
    if (done.length < 3 || done.length !== m.steps.length || !done.some((s) => s.tool && CODE.has(s.tool))) continue
    const asked = messages[i - 1]?.content.trim() ?? ''
    const cmd = /^\/([a-z0-9-]+)/.exec(asked)
    if (cmd && skills.includes(cmd[1])) continue
    if (done.some((s) => s.tool === 'use_skill')) continue
    return i === messages.length - 1 ? i : -1
  }
  return -1
}
