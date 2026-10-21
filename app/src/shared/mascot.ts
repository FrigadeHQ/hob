/**
 * Mabel, in pixels: a round lavender face on a 60×60 grid. The body is drawn in 2×2 "pixels" (a 30-wide
 * circle with a darker rim and dithered shading at the bottom); the face uses the finer grid, so the eyes,
 * smile and eyebrow sit where the original art has them. Shared by the app (animated) and the icon script.
 */
export type Expression = 'smile' | 'skeptical' | 'blink' | 'neutral'
export type Rect = { x: number; y: number; w: number; h: number; fill: string }

export const COLORS = { body: '#A9A5D9', rim: '#918CCB', light: '#B5B1E2', shade: '#9C97D1', ink: '#1C1B22' }

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
