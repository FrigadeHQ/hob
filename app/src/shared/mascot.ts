/**
 * Mabel, in pixels: a round lavender face on a 60×60 grid. The body is drawn in 2×2 "pixels" (a 30-wide
 * circle with a darker rim and dithered shading at the bottom); the face uses the finer grid, so the eyes,
 * smile and eyebrow sit where the original art has them. Shared by the app (animated) and the icon script.
 */
export type Expression = 'smile' | 'skeptical' | 'blink' | 'neutral' | 'laugh'
export type Rect = { x: number; y: number; w: number; h: number; fill: string }

export const COLORS = { body: '#A9A5D9', rim: '#918CCB', light: '#B5B1E2', shade: '#9C97D1', ink: '#1C1B22', tongue: '#E8899C' }

const R = 15
const inside = (i: number, j: number) => (i + 0.5 - R) ** 2 + (j + 0.5 - R) ** 2 <= R * R + 4

/** the body: one rect per 2×2 pixel */
export function bodyRects(): Rect[] {
  const out: Rect[] = []
  for (let j = 0; j < 2 * R; j++) {
    for (let i = 0; i < 2 * R; i++) {
      if (!inside(i, j)) continue
      const edge = !inside(i - 1, j) || !inside(i + 1, j) || !inside(i, j - 1) || !inside(i, j + 1)
      const d = Math.sqrt((i + 0.5 - R) ** 2 + (j + 0.5 - R) ** 2)
      let fill = COLORS.body
      if (edge) fill = COLORS.rim
      // soft dithered shading around the bottom, like the art: a checkerboard of two close tones
      else if (j >= 20 && d > R - 4.5 && (i + j) % 2 === 0) fill = j >= 25 ? COLORS.shade : COLORS.light
      // a little light on each cheek's edge
      else if ((j === 17 || j === 18) && (i === 1 || i === 2 * R - 2)) fill = COLORS.light
      out.push({ x: i * 2, y: j * 2, w: 2, h: 2, fill })
    }
  }
  return out
}

/** the face, shifted (dx, dy) on the fine grid to look somewhere; whole units keep it pixel-sharp */
export function faceRects(e: Expression, dx = 0, dy = 0): Rect[] {
  const ink = (x: number, y: number, w: number, h: number): Rect => ({ x: x + dx, y: y + dy, w, h, fill: COLORS.ink })
  // laughing (tickled): eyes squeezed shut as ^ ^, mouth wide open
  if (e === 'laugh') {
    const eye = (x: number) => [ink(x, 30, 2, 2), ink(x + 2, 28, 2, 2), ink(x + 4, 30, 2, 2)]
    return [...eye(14), ...eye(40),
      ink(24, 33, 12, 2), ink(24, 35, 2, 3), ink(34, 35, 2, 3), ink(26, 35, 8, 3), ink(26, 38, 8, 2),
      { x: 28 + dx, y: 37 + dy, w: 4, h: 2, fill: COLORS.tongue }]
  }
  const eyes = e === 'blink' ? [ink(15, 29, 5, 2), ink(40, 29, 5, 2)] : [ink(15, 27, 5, 5), ink(40, 27, 5, 5)]
  // the mouth moves less than the eyes: it's lower on the face
  const mx = Math.round(dx / 2)
  const my = Math.round(dy / 2)
  const m = (x: number, y: number, w: number, h: number): Rect => ({ x: x + mx, y: y + my, w, h, fill: COLORS.ink })
  const mouth = e === 'smile' || e === 'blink'
    ? [m(25, 35, 10, 2), m(23, 33, 2, 2), m(35, 33, 2, 2)]
    : [m(24, 33, 12, 2)]
  // the skeptical look: one eyebrow up, over the right eye
  const brow = e === 'skeptical' ? [ink(41, 21, 3, 2), ink(39, 23, 2, 2), ink(44, 23, 2, 2)] : []
  return [...eyes, ...brow, ...mouth]
}

/** an SVG of Mabel (for the icon and logo); size in pixels, square */
export function mascotSvg(e: Expression = 'smile', size = 512): string {
  const rect = (r: Rect) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${r.fill}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 60 60" shape-rendering="crispEdges">${[...bodyRects(), ...faceRects(e)].map(rect).join('')}</svg>`
}

/**
 * Mini Mabel (the status corner): her own 12×12 drawing, not the big one shrunk. At ~24 px the big face's
 * details are a pixel or less and blur away; here each art pixel is 2 screen pixels, so the eyes stay clear
 * and moving them a step is visible.
 */
const MINI = [
  '....rrrr....',
  '..rrbbbbrr..',
  '.rbbbbbbbbr.',
  '.rbbbbbbbbr.',
  'rbbbbbbbbbbr',
  'rbbbbbbbbbbr',
  'rbbbbbbbbbbr',
  'rlbbbbbbbblr',
  '.rbsbbbbsbr.',
  '.rbbsbsbbbr.',
  '..rrbbbbrr..',
  '....rrrr....',
]
const MINI_FILL: Record<string, string> = { r: COLORS.rim, b: COLORS.body, l: COLORS.light, s: COLORS.shade }

export function miniBodyRects(): Rect[] {
  return MINI.flatMap((row, y) => [...row].flatMap((c, x) => (MINI_FILL[c] ? [{ x, y, w: 1, h: 1, fill: MINI_FILL[c] }] : [])))
}

export function miniFaceRects(e: Expression, dx = 0, dy = 0): Rect[] {
  const ink = (x: number, y: number, w = 1, h = 1): Rect => ({ x: x + dx, y: y + dy, w, h, fill: COLORS.ink })
  if (e === 'laugh') return [ink(2, 4), ink(3, 3), ink(4, 4), ink(7, 4), ink(8, 3), ink(9, 4), ink(4, 6, 4, 1), ink(4, 7), ink(7, 7), { x: 5 + dx, y: 7 + dy, w: 2, h: 1, fill: COLORS.tongue }]
  const eyes = e === 'blink' ? [ink(3, 4), ink(8, 4)] : e === 'skeptical' ? [ink(3, 3, 1, 2), ink(8, 4), ink(8, 2, 2, 1)] : [ink(3, 3, 1, 2), ink(8, 3, 1, 2)]
  const mouth = e === 'smile' || e === 'blink' ? [ink(4, 6), ink(5, 7, 2, 1), ink(7, 6)] : [ink(4, 7, 4, 1)]
  return [...eyes, ...mouth]
}
