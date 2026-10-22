import { useEffect, useId, useRef, useState } from 'react'
import { faceRects, gazeOffset, tintMatrix, type Rect } from '../../../shared/mascot'
import bodyUrl from '../assets/garth-body.png'

const neutral = faceRects('neutral')
const eyes = neutral.slice(0, 2)
const flat = neutral.slice(2)
const smile = faceRects('smile').slice(2)
const brow = faceRects('skeptical').slice(2, 5)
const tint = tintMatrix()
const rect = (r: Rect, i: number) => <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill={r.fill} />

/** where the cursor is from Garth, -1..1 each way, eased so far away still reads as "over there" */
function useGaze(on: boolean) {
  const ref = useRef<SVGSVGElement>(null)
  const [gaze, setGaze] = useState({ x: 0, y: 0 })
  useEffect(() => {
    if (!on || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    // straight from the event (no animation frame): those pause in hidden windows, and moves are cheap
    const move = (e: PointerEvent) => {
      const box = ref.current?.getBoundingClientRect()
      if (!box) return
      const ease = (d: number) => Math.tanh(d / 220)
      setGaze({ x: ease(e.clientX - (box.left + box.width / 2)), y: ease(e.clientY - (box.top + box.height / 2)) })
    }
    // the cursor left the window: look back ahead
    const away = () => setGaze({ x: 0, y: 0 })
    window.addEventListener('pointermove', move)
    document.documentElement.addEventListener('pointerleave', away)
    return () => { window.removeEventListener('pointermove', move); document.documentElement.removeEventListener('pointerleave', away) }
  }, [on])
  return [ref, gaze] as const
}

/** Garth smiles; now and then goes flat or raises an eyebrow, and blinks. watch: the eyes follow the cursor. */
export function Mascot({ size = 96, alive = false, working = false, watch = false }: { size?: number; alive?: boolean; working?: boolean; watch?: boolean }) {
  const [ref, gaze] = useGaze(watch)
  const look = gazeOffset(gaze.x, gaze.y)
  const filter = `garth-tint-${useId().replace(/:/g, '')}`
  return (
    <svg ref={ref} data-testid="mascot" data-expression={working ? 'working' : 'smile'} width={size} height={size} viewBox="0 0 60 60" shapeRendering="crispEdges" role="img" aria-label="Garth"
      className={`garth-mascot overflow-visible shrink-0 ${alive ? 'garth-alive' : ''} ${working ? 'garth-working' : ''}`}>
      <defs><filter id={filter} colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values={tint} /></filter></defs>
      <ellipse cx="30" cy="62" rx="16" ry="2" fill="currentColor" opacity="0.08" />
      <svg width="60" height="60" viewBox="158 155.5 937 937">
        <image href={bodyUrl} width="1254" height="1254" filter={`url(#${filter})`} />
      </svg>
      <g className="garth-face">
        <g data-testid="mascot-look" transform={`translate(${look.eyes.x} ${look.eyes.y})`}>
          <g data-testid="mascot-eyes" className="garth-eyes">{eyes.map(rect)}</g>
          <g className="garth-brow">{brow.map(rect)}</g>
        </g>
        <g transform={`translate(${look.mouth.x} ${look.mouth.y})`}>
          <g className="garth-flat">{flat.map(rect)}</g>
          <g className="garth-smile">{smile.map(rect)}</g>
        </g>
      </g>
    </svg>
  )
}
