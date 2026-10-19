import { useEffect, useRef, useState } from 'react'

/** how far the eyes move (SVG units) and the body leans (degrees) toward the cursor */
const EYE_X = 16
const EYE_Y = 12
const LEAN = 5

/** where the cursor is from the hob, -1..1 each way, eased so far away still reads as "over there" */
function useGaze(on: boolean) {
  const ref = useRef<SVGSVGElement>(null)
  const [gaze, setGaze] = useState({ x: 0, y: 0 })
  useEffect(() => {
    if (!on || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let frame = 0
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const box = ref.current?.getBoundingClientRect()
        if (!box) return
        const dx = e.clientX - (box.left + box.width / 2)
        const dy = e.clientY - (box.top + box.height * 0.62)
        const ease = (d: number) => Math.tanh(d / 220)
        setGaze({ x: ease(dx), y: ease(dy) })
      })
    }
    // the cursor left the window: look back ahead
    const away = () => setGaze({ x: 0, y: 0 })
    window.addEventListener('pointermove', move)
    document.documentElement.addEventListener('pointerleave', away)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('pointermove', move); document.documentElement.removeEventListener('pointerleave', away) }
  }, [on])
  return [ref, gaze] as const
}

/** The hob: the flame-spirit from the app icon, on its own. alive: floats, breathes, flickers, blinks and watches the cursor. */
export function Mascot({ size = 96, alive = false }: { size?: number; alive?: boolean }) {
  const [ref, gaze] = useGaze(alive)
  return (
    <svg ref={ref} data-testid="mascot" width={size} height={size * 1.2} viewBox="290 200 444 560" role="img" aria-label="Hob" className={alive ? 'hob-alive' : undefined}>
      <defs>
        <linearGradient id="hob-flame" x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#FF9445" />
          <stop offset="0.55" stopColor="#EE5A1E" />
          <stop offset="1" stopColor="#C2410C" />
        </linearGradient>
        <radialGradient id="hob-glow" cx="0.5" cy="0.62" r="0.5">
          <stop offset="0" stopColor="#FFB070" stopOpacity="0.45" />
          <stop offset="1" stopColor="#FFB070" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse className="hob-glow" cx="512" cy="560" rx="230" ry="210" fill="url(#hob-glow)" />
      <g className="hob-lean" style={{ transform: `rotate(${gaze.x * LEAN}deg)` }}>
      <g className="hob-body">
        <path
          className="hob-flame"
          d="M512 232 C 554 312 654 356 694 458 C 736 566 670 736 512 740 C 354 736 288 566 330 458 C 358 386 422 356 458 310 C 466 350 484 372 506 380 C 496 328 490 280 512 232 Z"
          fill="url(#hob-flame)"
        />
        <g className="hob-look" data-testid="mascot-eyes" style={{ transform: `translate(${gaze.x * EYE_X}px, ${gaze.y * EYE_Y}px)` }}>
        <g className="hob-eyes">
          <ellipse cx="458" cy="574" rx="24" ry="32" fill="#2B1608" />
          <ellipse cx="566" cy="574" rx="24" ry="32" fill="#2B1608" />
          <circle cx="465" cy="563" r="8" fill="#FFFFFF" />
          <circle cx="573" cy="563" r="8" fill="#FFFFFF" />
        </g>
        </g>
        <ellipse cx="424" cy="628" rx="20" ry="11" fill="#FFD2B8" opacity="0.8" />
        <ellipse cx="600" cy="628" rx="20" ry="11" fill="#FFD2B8" opacity="0.8" />
      </g>
      </g>
    </svg>
  )
}
