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

it('click reactions keep the compact eyes and mouth from the expression study', () => {
  const geometry = (expression: Parameters<typeof faceRects>[0]) => faceRects(expression).map(({ x, y, w, h }) => [x, y, w, h])
  expect(geometry('content')).toEqual(geometry('blink'))
  expect(geometry('wink').slice(0, 2)).toEqual([[15, 27, 5, 5], [40, 29, 5, 2]])
  expect(geometry('laugh')).toEqual([
    [15, 29, 1, 2], [16, 27, 3, 2], [19, 29, 1, 2],
    [40, 29, 1, 2], [41, 27, 3, 2], [44, 29, 1, 2],
    [24, 33, 12, 2], [25, 35, 10, 2], [27, 37, 6, 1],
  ])
})
