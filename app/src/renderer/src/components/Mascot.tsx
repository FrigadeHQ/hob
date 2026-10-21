import { useEffect, useRef, useState } from 'react'
import { faceRects, type Expression, type Rect } from '../../../shared/mascot'
import bodyUrl from '../assets/garth-body.png'

const neutral = faceRects('neutral')
const smile = faceRects('smile').slice(2)
const rect = (r: Rect, i: number) => <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill={r.fill} />
const glances = [{ x: -3, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 0 }, { x: -2, y: 1 }, { x: 2, y: 1 }, { x: 0, y: -2 }]

/** Only setup listens to the cursor; normal chat never installs these listeners or timers. */
function useSetupFace(on: boolean) {
  const ref = useRef<SVGSVGElement>(null)
  const [gaze, setGaze] = useState({ x: 0, y: 0 })
  const [expression, setExpression] = useState<Expression>('neutral')
  useEffect(() => {
    if (!on) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    let glanceTimer: ReturnType<typeof setInterval>
    let faceTimer: ReturnType<typeof setTimeout>
    let lastMove = 0
    const look = (x: number, y: number) => setGaze((cur) => cur.x === x && cur.y === y ? cur : { x, y })
    const move = (e: PointerEvent) => {
      const box = ref.current?.getBoundingClientRect()
      if (!box || e.pointerType === 'touch') return
      lastMove = Date.now()
      look(Math.round(Math.tanh((e.clientX - box.left - box.width / 2) / 220) * 3), Math.round(Math.tanh((e.clientY - box.top - box.height / 2) / 220) * 2))
    }
    const nextFace = () => {
      const r = Math.random()
      const [face, hold] = r < .16 ? (['skeptical', 1400] as const) : r < .48 ? (['smile', 1600] as const) : (['neutral-blink', 150] as const)
      setExpression(face)
      faceTimer = setTimeout(() => {
        setExpression('neutral')
        faceTimer = setTimeout(nextFace, 2800 + Math.random() * 3000)
      }, hold)
    }
    const stop = () => {
      clearInterval(glanceTimer)
      clearTimeout(faceTimer)
      window.removeEventListener('pointermove', move)
      look(0, 0)
      setExpression('neutral')
    }
    const sync = () => {
      stop()
      if (reduced.matches) return
      lastMove = 0
      window.addEventListener('pointermove', move)
      glanceTimer = setInterval(() => {
        if (Date.now() - lastMove <= 2500) return
        const spot = glances[Math.floor(Math.random() * glances.length)]
        look(spot.x, spot.y)
      }, 3500)
      faceTimer = setTimeout(nextFace, 1500)
    }
    sync()
    reduced.addEventListener('change', sync)
    return () => { stop(); reduced.removeEventListener('change', sync) }
  }, [on])
  return { ref, gaze, expression }
}

/** Setup is playful; in the app, the face only blinks and occasionally smiles. */
export function Mascot({ size = 96, alive = false, working = false, playful = false }: { size?: number; alive?: boolean; working?: boolean; playful?: boolean }) {
  const setup = useSetupFace(alive && playful)
  return (
    <svg ref={setup.ref} data-testid="mascot" data-expression={playful ? setup.expression : working ? 'working' : 'neutral'} width={size} height={size} viewBox="0 0 60 60" shapeRendering="crispEdges" role="img" aria-label="Garth"
      className={`garth-mascot overflow-visible shrink-0 ${alive && !playful ? 'garth-alive' : ''} ${working ? 'garth-working' : ''}`}>
      <ellipse cx="30" cy="62" rx="16" ry="2" fill="currentColor" opacity="0.08" />
      <svg width="60" height="60" viewBox="158 155.5 937 937">
        <image href={bodyUrl} width="1254" height="1254" />
      </svg>
      <g className="garth-face">
        {playful ? <g data-testid="mascot-eyes">{faceRects(setup.expression, setup.gaze.x, setup.gaze.y).map(rect)}</g> : <>
          <g data-testid="mascot-eyes" className="garth-eyes">{neutral.slice(0, 2).map(rect)}</g>
          <g className="garth-neutral">{neutral.slice(2).map(rect)}</g>
          <g className="garth-smile">{smile.map(rect)}</g>
        </>}
      </g>
    </svg>
  )
}
