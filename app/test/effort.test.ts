import { expect, it } from 'vitest'
import { EFFORTS, effortBudgets } from '../src/shared/effort'

it('Normal thinks as Hob always has; Quick less, Deep more', () => {
  expect(effortBudgets('normal', false)).toEqual({ thoughtBudget: 256, thoughtBudgetWithTools: 8192 })
  expect(effortBudgets('normal', true)).toEqual({ thoughtBudget: 8192, thoughtBudgetWithTools: 8192 })
  const q = effortBudgets('quick', true), n = effortBudgets('normal', true), d = effortBudgets('deep', true)
  expect(q.thoughtBudget).toBeLessThan(n.thoughtBudget)
  expect(d.thoughtBudget).toBeGreaterThan(n.thoughtBudget)
  // a little thinking even when quick: with none at all, Gemma writes its thinking into the reply
  expect(effortBudgets('quick', false).thoughtBudget).toBeGreaterThan(0)
  // never more than a 16K context holds
  expect(d.thoughtBudgetWithTools).toBeLessThanOrEqual(16384)
})

it("gpt-oss's own reasoning level follows; Normal leaves its default alone", () => {
  expect(effortBudgets('quick', false).reasoning).toBe('low')
  expect(effortBudgets('normal', false).reasoning).toBeUndefined()
  expect(effortBudgets('deep', false).reasoning).toBe('high')
})

it('three levels in order, Normal the default, each with a plain description', () => {
  expect(EFFORTS.map((e) => e.id)).toEqual(['quick', 'normal', 'deep'])
  expect(EFFORTS.every((e) => e.label && e.description)).toBe(true)
})
