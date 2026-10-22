import { expect, it } from 'vitest'
import { withMath } from '../src/shared/markdown'

it('LaTeX in \\( \\) and \\[ \\] becomes math Markdown can draw', () => {
  expect(withMath('So \\(x^2 + 1 = 5\\), and')).toBe('So $$x^2 + 1 = 5$$, and')
  expect(withMath('Solve:\n\\[\n\\frac{a}{b} = 2\n\\]\nDone')).toBe('Solve:\n\n$$\n\\frac{a}{b} = 2\n$$\n\nDone')
  expect(withMath('Area: \\[ \\pi r^2 \\]')).toBe('Area:\n\n$$\n\\pi r^2\n$$\n\n')
})

it('single dollars: math when it looks like math, money otherwise', () => {
  expect(withMath('where $x^2$ is the area and $\\alpha$ the angle')).toBe('where $$x^2$$ is the area and $$\\alpha$$ the angle')
  expect(withMath('let $n$ be the count')).toBe('let $$n$$ be the count')
  const money = 'growing from $76,000 in July to $90,000 by September'
  expect(withMath(money)).toBe(money)
  expect(withMath('It costs $5 or $10 = a lot')).toBe('It costs $5 or $10 = a lot')
})

it('$$ blocks stay; code is left alone', () => {
  expect(withMath('$$\nE = mc^2\n$$')).toBe('$$\nE = mc^2\n$$')
  expect(withMath('Use `\\(x\\)` in LaTeX')).toBe('Use `\\(x\\)` in LaTeX')
  expect(withMath('```\nprint("$x^2$")\n```')).toBe('```\nprint("$x^2$")\n```')
})
