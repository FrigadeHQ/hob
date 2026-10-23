'use client'
import { useEffect, useRef, useState } from 'react'

// Hob as in the app (app/src/shared/mascot.ts, components/Mascot.tsx): the crisp Iris SVG, a
// pixel face on a 60×60 grid that smiles, blinks now and then, and looks toward the cursor in whole pixels.
const INK = '#292929'
type Rect = [x: number, y: number, w: number, h: number]
const eyes = (closed: boolean): Rect[] => [[15, closed ? 29 : 27, 5, closed ? 2 : 5], [40, closed ? 29 : 27, 5, closed ? 2 : 5]]
const SMILE: Rect[] = [[25, 35, 10, 2], [23, 33, 2, 2], [35, 33, 2, 2]]

export function Mascot({ size = 88 }: { size?: number }) {
  const ref = useRef<SVGSVGElement>(null)
  const [look, setLook] = useState({ x: 0, y: 0 })
  const [blink, setBlink] = useState(false)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const move = (e: PointerEvent) => {
      const box = ref.current?.getBoundingClientRect()
      if (!box || e.pointerType === 'touch') return
      const x = Math.round(Math.tanh((e.clientX - box.left - box.width / 2) / 220) * 3)
      const y = Math.round(Math.tanh((e.clientY - box.top - box.height / 2) / 220) * 2)
      setLook((cur) => (cur.x === x && cur.y === y ? cur : { x, y }))
    }
    const away = () => setLook({ x: 0, y: 0 })
    let t: ReturnType<typeof setTimeout>
    const nextBlink = () => { t = setTimeout(() => { setBlink(true); t = setTimeout(() => { setBlink(false); nextBlink() }, 150) }, 3500 + Math.random() * 4000) }
    nextBlink()
    window.addEventListener('pointermove', move)
    document.documentElement.addEventListener('pointerleave', away)
    return () => { clearTimeout(t); window.removeEventListener('pointermove', move); document.documentElement.removeEventListener('pointerleave', away) }
  }, [])
  const mouth = { x: Math.trunc(look.x / 2), y: Math.trunc(look.y / 2) }
  const rect = ([x, y, w, h]: Rect, dx: number, dy: number, i: number) => <rect key={i} x={x + dx} y={y + dy} width={w} height={h} fill={INK} />
  return (
    <svg ref={ref} width={size} height={size} viewBox="0 0 60 60" shapeRendering="crispEdges" role="img" aria-label="Hob, a round lavender face, smiling" className="mascot" overflow="visible">
      <ellipse cx="30" cy="62" rx="16" ry="2" fill="currentColor" opacity="0.08" />
      <svg width="60" height="60" viewBox="158 155.5 937 937">
        <image href="/hob-body.svg" width="1254" height="1254" />
      </svg>
      {eyes(blink).map((r, i) => rect(r, look.x, look.y, i))}
      {SMILE.map((r, i) => rect(r, mouth.x, mouth.y, i + 2))}
    </svg>
  )
}
