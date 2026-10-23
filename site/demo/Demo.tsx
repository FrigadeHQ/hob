import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Hero } from './Hero'
import { frameAt, TIMING } from './sequence'
import { setPreviewChat } from './preview-api'

function Demo() {
  const [elapsed, setElapsed] = useState(0)
  const [reduced, setReduced] = useState(matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [visible, setVisible] = useState(window.parent === window)
  const time = useRef(0)
  const lastFrame = useRef('')
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const change = () => setReduced(media.matches)
    const receive = (event: MessageEvent) => {
      if (event.source === parent && event.data?.type === 'hob-demo-visibility' && typeof event.data.visible === 'boolean') setVisible(event.data.visible)
    }
    media.addEventListener('change', change)
    window.addEventListener('message', receive)
    parent.postMessage({ type: 'hob-demo-ready' }, '*')
    return () => { media.removeEventListener('change', change); window.removeEventListener('message', receive) }
  }, [])
  useEffect(() => {
    if (reduced || !visible) return
    let raf = 0, last = performance.now(), paint = last
    const tick = (now: number) => {
      if (!document.hidden) time.current = (time.current + Math.min(now - last, 80)) % TIMING.end
      last = now
      if (now - paint >= 32) {
        const f = frameAt(time.current)
        const key = [f.phase, f.value, f.dropping, f.pressing, f.replyWords, f.summary, f.fading].join('|')
        if (key !== lastFrame.current) { setElapsed(time.current); lastFrame.current = key }
        paint = now
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [visible, reduced])
  const frame = frameAt(elapsed, reduced)
  useLayoutEffect(() => { setPreviewChat(frame.sent, frame.running, frame.done) }, [frame.sent, frame.running, frame.done])
  return <Hero frame={frame} paused={!visible} />
}

createRoot(document.getElementById('preview')!).render(<Demo />)
