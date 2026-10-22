/**
 * Garth's face, in pixels on a 60×60 grid, drawn over the body artwork (assets/garth-body.png).
 * Shared by the app (animated) and the icon script.
 */
export type Expression = 'smile' | 'skeptical' | 'blink' | 'neutral' | 'neutral-blink'
export type Rect = { x: number; y: number; w: number; h: number; fill: string }

const INK = '#1C1B22'

/** Garth's colour. The body art is grey; this is what its main tone becomes. */
export const BODY_COLOR = '#A9A5D9'
/** the art's main grey, measured from the PNG */
const ART_GREY = [189, 186, 182]

/** an feColorMatrix that colours the grey art: each channel scaled, so the rim and shading keep their depth */
export function tintMatrix(hex = BODY_COLOR): string {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const [r, g, b] = rgb.map((c, i) => +(c / ART_GREY[i]).toFixed(3))
  return `${r} 0 0 0 0 0 ${g} 0 0 0 0 0 ${b} 0 0 0 0 0 1 0`
}

/** the face, shifted (dx, dy) on the fine grid to look somewhere; whole units keep it pixel-sharp */
export function faceRects(e: Expression, dx = 0, dy = 0): Rect[] {
  const ink = (x: number, y: number, w: number, h: number): Rect => ({ x: x + dx, y: y + dy, w, h, fill: INK })
  const eyes = e === 'blink' || e === 'neutral-blink' ? [ink(15, 29, 5, 2), ink(40, 29, 5, 2)] : [ink(15, 27, 5, 5), ink(40, 27, 5, 5)]
  // the mouth moves less than the eyes: it's lower on the face
  const mx = Math.round(dx / 2)
  const my = Math.round(dy / 2)
  const m = (x: number, y: number, w: number, h: number): Rect => ({ x: x + mx, y: y + my, w, h, fill: INK })
  const mouth = e === 'smile' || e === 'blink'
    ? [m(25, 35, 10, 2), m(23, 33, 2, 2), m(35, 33, 2, 2)]
    : [m(24, 33, 12, 2)]
  // the skeptical look: one eyebrow up, over the right eye
  const brow = e === 'skeptical' ? [ink(41, 21, 3, 2), ink(39, 23, 2, 2), ink(44, 23, 2, 2)] : []
  return [...eyes, ...brow, ...mouth]
}

/** how far the face moves toward the cursor: x, y from -1 to 1 → whole grid units, the eyes more than the mouth */
export function gazeOffset(x: number, y: number) {
  const whole = (n: number) => Math.round(n) || 0
  const half = (n: number) => Math.trunc(n / 2) || 0
  const eyes = { x: whole(x * 3), y: whole(y * 2) }
  return { eyes, mouth: { x: half(eyes.x), y: half(eyes.y) } }
}
