import { useEffect, useRef, useState } from 'react'
import { bodyRects, faceRects, miniBodyRects, miniFaceRects, type Expression } from '../../../shared/mascot'

/** how far the face moves toward where Garth looks, in grid units (whole units keep it pixel-sharp) */
const LOOK_X = 3
const LOOK_Y = 2
const BODY = bodyRects()
const MINI_BODY = miniBodyRects()

/** where to look, -1..1 each way: the cursor when it moves, otherwise a glance around now and then */
function useGaze(on: boolean) {
  const ref = useRef<SVGSVGElement>(null)
  const [gaze, setGaze] = useState({ x: 0, y: 0 })
  useEffect(() => {
    if (!on || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let lastMove = 0
    const move = (e: PointerEvent) => {
      const box = ref.current?.getBoundingClientRect()
      if (!box) return
      lastMove = Date.now()
      const ease = (d: number) => Math.tanh(d / 220)
      setGaze({ x: ease(e.clientX - (box.left + box.width / 2)), y: ease(e.clientY - (box.top + box.height / 2)) })
    }
    // no cursor for a while: look around the room
    const spots = [{ x: -1, y: -0.3 }, { x: 1, y: -0.2 }, { x: 0, y: 0 }, { x: -0.6, y: 0.6 }, { x: 0.7, y: 0.5 }, { x: 0, y: -0.8 }]
    const t = setInterval(() => { if (Date.now() - lastMove > 2500) setGaze(spots[Math.floor(Math.random() * spots.length)]) }, 1700)
    window.addEventListener('pointermove', move)
    return () => { clearInterval(t); window.removeEventListener('pointermove', move) }
  }, [on])
  return [ref, gaze] as const
}

/** smiling (or `base`) most of the time; blinks, and now and then a skeptical raised eyebrow */
function useExpression(on: boolean, base: Expression = 'smile'): Expression {
  const [e, setE] = useState<Expression>(base)
  useEffect(() => {
    setE(base)
    if (!on || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let t: ReturnType<typeof setTimeout>
    const next = () => {
      const r = Math.random()
      const [face, hold] = r < 0.22 ? (['skeptical', 1600] as const) : r < 0.3 ? (['neutral', 1200] as const) : (['blink', 140] as const)
      setE(face)
      t = setTimeout(() => { setE(base); t = setTimeout(next, 1800 + Math.random() * 2600) }, hold)
    }
    t = setTimeout(next, 1500)
    return () => clearTimeout(t)
  }, [on, base])
  return e
}

const rect = (r: { x: number; y: number; w: number; h: number; fill: string }, i: number) => <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill={r.fill} />

/**
 * Garth, in pixels. alive: looks at the cursor (or around), blinks, and sometimes looks skeptical.
 * mini: the small drawing, for the status corner. busy: bobs while working on something (getting smarter).
 * ticklish: a click makes Garth laugh.
 */
export function Mascot({ size = 96, alive = false, mini = false, busy = false, base, ticklish = false, label = 'Garth' }: {
  size?: number; alive?: boolean; mini?: boolean; busy?: boolean; base?: Expression; ticklish?: boolean; label?: string
}) {
  const [ref, gaze] = useGaze(alive)
  const mood = useExpression(alive, base)
  const [laughing, setLaughing] = useState(false)
  useEffect(() => {
    if (!laughing) return
    const t = setTimeout(() => setLaughing(false), 1300)
    return () => clearTimeout(t)
  }, [laughing])
  const expression = laughing ? 'laugh' : mood
  // a step of the small drawing is two screen pixels: one is enough to see where Garth looks
  const dx = Math.round(gaze.x * (mini ? 1 : LOOK_X)), dy = Math.round(gaze.y * (mini ? 1 : LOOK_Y))
  const face = mini ? miniFaceRects(expression, dx, dy) : faceRects(expression, dx, dy)
  const grid = mini ? 12 : 60
  const svg = (
    <svg ref={ref} data-testid="mascot" data-expression={expression} width={size} height={size} viewBox={`0 0 ${grid} ${grid}`} shapeRendering="crispEdges" role="img" aria-label={label}
      className={`overflow-visible ${mini ? 'garth-mini' : ''} ${alive ? 'garth-alive' : ''} ${busy && !laughing ? 'garth-busy' : ''} ${laughing ? 'garth-giggle' : ''}`}>
      {!mini && <ellipse className="garth-shadow" cx="30" cy="62" rx="16" ry="2" fill="currentColor" opacity="0.08" />}
      <g className="garth-body">
        {(mini ? MINI_BODY : BODY).map(rect)}
        <g data-testid="mascot-eyes">{face.map(rect)}</g>
      </g>
    </svg>
  )
  if (!ticklish) return svg
  return (
    <button type="button" data-testid="mascot-tickle" aria-label={`${label}. Click to tickle`} onClick={() => setLaughing(true)} className="inline-flex shrink-0 cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-line-strong">
      {svg}
    </button>
  )
}
