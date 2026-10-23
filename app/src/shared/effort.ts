/** How long Hob thinks before it answers: picked beside the mic, kept in settings. */
export type Effort = 'quick' | 'normal' | 'deep'

export const EFFORTS: { id: Effort; label: string; description: string }[] = [
  { id: 'quick', label: 'Quick', description: 'Answers fastest, thinks briefly' },
  { id: 'normal', label: 'Normal', description: 'Thinks as long as most things need' },
  { id: 'deep', label: 'Deep', description: 'Thinks longer on hard problems. Slower' },
]

export const DEFAULT_EFFORT: Effort = 'normal'
export const isEffort = (e: unknown): e is Effort => EFFORTS.some((x) => x.id === e)

// thinking tokens: for a plain question, and once it's a task (a tool was called, or files are involved).
// Quick still thinks a little: with no thinking at all Gemma writes its thinking into the reply. Deep stays within
// a 16K context.
const BUDGETS: Record<Effort, [number, number]> = { quick: [64, 1024], normal: [256, 8192], deep: [4096, 16384] }

/** the thinking budgets for a reply; reasoning: gpt-oss's own level (left at its default for Normal) */
export function effortBudgets(effort: Effort, usesFiles: boolean): { thoughtBudget: number; thoughtBudgetWithTools: number; reasoning?: 'low' | 'high' } {
  const [chat, task] = BUDGETS[effort]
  return {
    thoughtBudget: usesFiles ? task : chat, thoughtBudgetWithTools: task,
    ...(effort === 'quick' ? { reasoning: 'low' as const } : effort === 'deep' ? { reasoning: 'high' as const } : {}),
  }
}
