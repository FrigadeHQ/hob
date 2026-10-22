import { expect, it } from 'vitest'
import { faceRects, tintMatrix } from '../src/shared/mascot'

it('the tint turns the art grey into the body colour', () => {
  const [r, , , , , , g, , , , , , b] = tintMatrix('#A9A5D9').split(' ').map(Number)
  expect(Math.round(189 * r)).toBe(0xa9)
  expect(Math.round(186 * g)).toBe(0xa5)
  expect(Math.round(182 * b)).toBe(0xd9)
})

it('the raised eyebrow sits over one eye', () => {
  expect(faceRects('skeptical').length - faceRects('neutral').length).toBe(3)
})
