import type { Step } from './agent'

/** a row in the work log: one step, or several tries of the same step */
export type StepRow = Omit<Step, 'status'> & { status: Step['status'] | 'retrying'; tries: number }

/**
 * Trying code again until it works is normal: show the tries as one row with the last try's outcome.
 * A failed last try shows as "retrying" while the reply is still being worked on and it's the newest row.
 * Steps that failed are left out once something else worked: the user sees what got done, not the stumbles.
 */
export function stepRows(steps: Step[], running: boolean): StepRow[] {
  const groups: Step[][] = []
  for (const s of steps) {
    const last = groups.at(-1)
    if (last && last[0].title === s.title && last[0].tool === s.tool && last.at(-1)!.status === 'error') last.push(s)
    else groups.push([s])
  }
  const rows: StepRow[] = groups.map((g, i) => {
    const end = g.at(-1)!
    const status = end.status === 'error' && running && i === groups.length - 1 ? 'retrying' : end.status
    const details = g.filter((t) => t.detail)
    const detail = g.length === 1 ? end.detail : details.length ? details.map((t) => `--- Try ${g.indexOf(t) + 1} ---\n${t.detail}`).join('\n\n') : undefined
    return { ...end, status, tries: g.length, ...(detail ? { detail } : {}) }
  })
  // hiccups on the way to a result aren't worth showing; when nothing worked, they explain why
  return rows.some((r) => r.status === 'done') ? rows.filter((r) => r.status !== 'error') : rows
}
