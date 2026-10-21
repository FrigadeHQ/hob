import { useEffect, useRef, useState } from 'react'
import { bodyRects, faceRects, type Expression } from '../../../shared/mascot'

/** how far the face moves toward where Mabel looks, in grid units (whole units keep it pixel-sharp) */
const LOOK_X = 3
const LOOK_Y = 2
const BODY = bodyRects()

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

/** smiling most of the time; blinks, and now and then a skeptical raised eyebrow */
function useExpression(on: boolean): Expression {
  const [e, setE] = useState<Expression>('smile')
  useEffect(() => {
    if (!on || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let t: ReturnType<typeof setTimeout>
    const next = () => {
      const r = Math.random()
      const [face, hold] = r < 0.22 ? (['skeptical', 1600] as const) : r < 0.3 ? (['neutral', 1200] as const) : (['blink', 140] as const)
      setE(face)
      t = setTimeout(() => { setE('smile'); t = setTimeout(next, 1800 + Math.random() * 2600) }, hold)
    }
    t = setTimeout(next, 1500)
    return () => clearTimeout(t)
  }, [on])
  return e
}

/** Mabel, in pixels. alive: bobs, looks at the cursor (or around), blinks, and sometimes looks skeptical. */
export function Mascot({ size = 96, alive = false }: { size?: number; alive?: boolean }) {
  const [ref, gaze] = useGaze(alive)
  const expression = useExpression(alive)
  const face = faceRects(expression, Math.round(gaze.x * LOOK_X), Math.round(gaze.y * LOOK_Y))
  return (
    <svg ref={ref} data-testid="mascot" data-expression={expression} width={size} height={size} viewBox="0 0 60 60" shapeRendering="crispEdges" role="img" aria-label="Mabel"
      className={`overflow-visible ${alive ? 'mabel-alive' : ''}`}>
      <ellipse className="mabel-shadow" cx="30" cy="62" rx="16" ry="2" fill="currentColor" opacity="0.08" />
      <g className="mabel-body">
        {BODY.map((r, i) => <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill={r.fill} />)}
        <g data-testid="mascot-eyes">{face.map((r, i) => <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill={r.fill} />)}</g>
      </g>
    </svg>
  )
}
