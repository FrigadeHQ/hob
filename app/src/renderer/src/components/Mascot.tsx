import { useEffect, useRef, useState } from 'react'
import { faceRects, type Expression, type Rect } from '../../../shared/mascot'
import bodyUrl from '../assets/hob-body.svg'

const neutral = faceRects('neutral')
const smile = faceRects('smile').slice(2)
const rect = (r: Rect, i: number) => <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill={r.fill} />
const glances = [{ x: -3, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 0 }, { x: -2, y: 1 }, { x: 2, y: 1 }, { x: 0, y: -2 }]
const greetings: Partial<Record<Expression, string>> = { content: 'Hob smiles.', wink: 'Hob winks.', laugh: 'Hob laughs.', skeptical: 'Hob raises an eyebrow.' }

/** Click reactions are shared; only setup and the empty chat look around. */
function usePlayfulFace(on: boolean) {
  const ref = useRef<SVGSVGElement>(null)
  const [gaze, setGaze] = useState({ x: 0, y: 0 })
  const [expression, setExpression] = useState<Expression>('smile')
  const [reaction, setReaction] = useState<Expression | null>(null)
  const taps = useRef({ count: 0, at: -Infinity })
  const reactionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const sayHello = () => {
    const now = Date.now()
    const count = now - taps.current.at > 1800 ? 1 : Math.min(6, taps.current.count + 1)
    taps.current = { count, at: now }
    clearTimeout(reactionTimer.current)
    setReaction(count >= 6 ? 'skeptical' : count >= 3 ? 'laugh' : count === 2 ? 'wink' : 'content')
    reactionTimer.current = setTimeout(() => {
      setReaction(null)
      setExpression('smile')
    }, count >= 6 ? 1400 : count >= 3 ? 1100 : 700)
  }
  useEffect(() => {
    if (!on) return () => clearTimeout(reactionTimer.current)
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
      // mostly a blink; now and then, briefly, a raised eyebrow or a straight face
      const [face, hold] = r < .06 ? (['skeptical', 700] as const) : r < .14 ? (['neutral', 800] as const) : (['blink', 150] as const)
      setExpression(face)
      faceTimer = setTimeout(() => {
        setExpression('smile')
        faceTimer = setTimeout(nextFace, 4500 + Math.random() * 3000)
      }, hold)
    }
    const stop = () => {
      clearInterval(glanceTimer)
      clearTimeout(faceTimer)
      clearTimeout(reactionTimer.current)
      taps.current = { count: 0, at: -Infinity }
      setReaction(null)
      window.removeEventListener('pointermove', move)
      look(0, 0)
      setExpression('smile')
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
      faceTimer = setTimeout(nextFace, 3200)
    }
    sync()
    reduced.addEventListener('change', sync)
    return () => { stop(); reduced.removeEventListener('change', sync) }
  }, [on])
  return { ref, gaze, expression: reaction ?? expression, reaction, sayHello }
}

/** Every living Hob responds to a hello; the sidebar keeps its quiet idle face. */
export function Mascot({ size = 96, alive = false, working = false, playful = false }: { size?: number; alive?: boolean; working?: boolean; playful?: boolean }) {
  const face = usePlayfulFace(alive && playful)
  const interactive = alive || playful
  const expression = playful || face.reaction ? face.expression : null
  const artwork = (
    <svg ref={face.ref} data-testid="mascot" data-expression={expression ?? (working ? 'working' : 'smile')} width={size} height={size} viewBox="0 0 60 60" shapeRendering="crispEdges" role="img" aria-label="Hob" aria-hidden={interactive || undefined}
      className={`hob-mascot overflow-visible shrink-0 ${alive && !playful ? 'hob-alive' : ''} ${working ? 'hob-working' : ''}`}>
      <ellipse cx="30" cy="62" rx="16" ry="2" fill="currentColor" opacity="0.08" />
      <svg width="60" height="60" viewBox="158 155.5 937 937">
        <image href={bodyUrl} width="1254" height="1254" />
      </svg>
      <g className="hob-face">
        {expression ? <g data-testid="mascot-eyes">{faceRects(expression, face.gaze.x, face.gaze.y).map(rect)}</g> : <>
          <g data-testid="mascot-eyes" className="hob-eyes">{neutral.slice(0, 2).map(rect)}</g>
          <g className="hob-neutral">{neutral.slice(2).map(rect)}</g>
          <g className="hob-smile">{smile.map(rect)}</g>
        </>}
      </g>
    </svg>
  )
  return interactive ? <button type="button" className="hob-interaction" aria-label="Say hello to Hob" onClick={face.sayHello}>
    {artwork}<span className="sr-only" role="status">{face.reaction ? greetings[face.reaction] : ''}</span>
  </button> : artwork
}
