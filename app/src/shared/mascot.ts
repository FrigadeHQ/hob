/**
 * Hob's face, in pixels on a 60×60 grid, drawn over the Iris SVG (assets/hob-body.svg).
 * Shared by the app (animated) and the icon script.
 */
export type Expression = 'smile' | 'skeptical' | 'blink' | 'neutral' | 'neutral-blink' | 'content' | 'wink' | 'laugh'
export type Rect = { x: number; y: number; w: number; h: number; fill: string }

const INK = '#292929'

/** the face, shifted (dx, dy) on the fine grid to look somewhere; whole units keep it pixel-sharp */
export function faceRects(e: Expression, dx = 0, dy = 0): Rect[] {
  const ink = (x: number, y: number, w: number, h: number): Rect => ({ x: x + dx, y: y + dy, w, h, fill: INK })
  const closed = e === 'blink' || e === 'neutral-blink' || e === 'content'
  const eyes = e === 'laugh'
    ? [ink(15, 29, 1, 2), ink(16, 27, 3, 2), ink(19, 29, 1, 2), ink(40, 29, 1, 2), ink(41, 27, 3, 2), ink(44, 29, 1, 2)]
    : [ink(15, closed ? 29 : 27, 5, closed ? 2 : 5), ink(40, closed || e === 'wink' ? 29 : 27, 5, closed || e === 'wink' ? 2 : 5)]
  // the mouth moves less than the eyes: it's lower on the face
  const mx = Math.round(dx / 2)
  const my = Math.round(dy / 2)
  const m = (x: number, y: number, w: number, h: number): Rect => ({ x: x + mx, y: y + my, w, h, fill: INK })
  const mouth = e === 'laugh'
    ? [m(24, 33, 12, 2), m(25, 35, 10, 2), m(27, 37, 6, 1)]
    : e === 'smile' || e === 'blink' || e === 'content' || e === 'wink'
    ? [m(25, 35, 10, 2), m(23, 33, 2, 2), m(35, 33, 2, 2)]
    : [m(24, 33, 12, 2)]
  // the skeptical look: one eyebrow up, over the right eye
  const brow = e === 'skeptical' ? [ink(41, 21, 3, 2), ink(39, 23, 2, 2), ink(44, 23, 2, 2)] : []
  return [...eyes, ...brow, ...mouth]
}
