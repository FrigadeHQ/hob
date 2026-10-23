import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronLeft, ChevronRight, Mic } from 'lucide-react'
import { hob } from '../api'
import { LANGUAGES, prefs } from '../speech/prefs'

type Device = { id: string; label: string }

/** the microphones this computer has; "Default - Yeti" first, like the system's own menu */
async function microphones(): Promise<Device[]> {
  const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications')
  // names without the USB codes Chromium adds: "Yeti Stereo Microphone (046d:0ab7)"
  const tidy = (l: string) => l.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '')
  const list = all.map((d, i) => ({ id: d.deviceId || 'default', label: tidy(d.label) || (d.deviceId === 'default' ? 'Default microphone' : `Microphone ${i + 1}`) }))
  if (!list.some((d) => d.id === 'default')) list.unshift({ id: 'default', label: 'Default microphone' })
  return list.sort((a, b) => (a.id === 'default' ? -1 : b.id === 'default' ? 1 : 0))
}

/** The arrow next to the mic: pick the microphone (with a live level), and dictation's language. */
export function MicMenu({ disabled }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'mics' | 'language'>('mics')
  const [devices, setDevices] = useState<Device[]>([])
  const [mic, setMic] = useState(prefs.mic())
  const [language, setLanguage] = useState(prefs.language())
  const [level, setLevel] = useState(0)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => { if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', close); window.addEventListener('keydown', close)
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', close) }
  }, [open])

  // while open: list the microphones and show how loud the chosen one is (names appear once access is allowed)
  useEffect(() => {
    if (!open || hob.fake) { void (open ? microphones().then(setDevices).catch(() => {}) : undefined); return }
    let stream: MediaStream | undefined
    let ctx: AudioContext | undefined
    let t: ReturnType<typeof setInterval> | undefined
    let stopped = false
    const refresh = () => void microphones().then(setDevices).catch(() => {})
    void (async () => {
      refresh()
      if (!(await hob.speech.mic()) || stopped) return
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: mic === 'default' ? true : { deviceId: { ideal: mic } } })
        if (stopped) { stream.getTracks().forEach((x) => x.stop()); return }
        refresh()
        ctx = new AudioContext()
        const an = ctx.createAnalyser(); an.fftSize = 512
        ctx.createMediaStreamSource(stream).connect(an)
        const buf = new Float32Array(512)
        // a timer, not animation frames: those pause in hidden windows
        t = setInterval(() => { an.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v; setLevel(Math.min(1, Math.sqrt(s / buf.length) * 6)) }, 60)
      } catch { /* no level, the list still works */ }
    })()
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => {
      stopped = true
      navigator.mediaDevices.removeEventListener('devicechange', refresh)
      if (t) clearInterval(t)
      stream?.getTracks().forEach((x) => x.stop())
      void ctx?.close().catch(() => {})
      setLevel(0)
    }
  }, [open, mic])

  const item = 'flex w-full items-center gap-2 rounded-control px-2.5 py-1.5 text-left text-ui hover:bg-line/70'
  const lang = LANGUAGES.find((l) => l.id === language) ?? LANGUAGES[0]
  return (
    <div ref={box} className="relative">
      <button type="button" data-testid="mic-menu" aria-label="Microphone and dictation settings" title="Microphone and dictation settings" disabled={disabled} aria-expanded={open}
        onClick={() => { setOpen((o) => !o); setView('mics') }}
        className="no-drag inline-flex h-8 w-5 items-center justify-center rounded-control text-muted transition-colors hover:bg-line/70 hover:text-ink disabled:opacity-40">
        <ChevronDown size={13} />
      </button>
      {open && (
        <div data-testid="mic-options" role="menu" className="pop absolute bottom-full right-0 z-30 mb-2 w-72 rounded-card border border-line bg-surface p-1 shadow-lg">
          {view === 'mics' ? (
            <>
              <div className="flex items-center gap-2 px-2.5 py-2">
                <Mic size={14} className="shrink-0 text-muted" />
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                  <div data-testid="mic-level" className="h-full rounded-full bg-accent transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
                </div>
              </div>
              <div className="max-h-56 overflow-y-auto">
                {devices.map((d) => (
                  <button key={d.id} role="menuitemradio" aria-checked={d.id === mic} data-testid="mic-option" className={item}
                    onClick={() => { setMic(d.id); prefs.setMic(d.id) }}>
                    <span className="min-w-0 flex-1 truncate">{d.label}</span>
                    {d.id === mic && <Check size={14} className="shrink-0 text-ink" />}
                  </button>
                ))}
              </div>
              <div className="my-1 border-t border-line" />
              <p className="px-2.5 pt-1 pb-0.5 text-meta text-muted">Dictation settings</p>
              <button data-testid="dictation-language" className={item} onClick={() => setView('language')}>
                <span className="flex-1">Language</span>
                <span className="text-muted">{lang.label}</span><ChevronRight size={14} className="text-muted" />
              </button>
            </>
          ) : (
            <>
              <button className={`${item} text-ink-soft`} onClick={() => setView('mics')}><ChevronLeft size={14} />Language</button>
              <div className="max-h-64 overflow-y-auto">
                {LANGUAGES.map((l) => (
                  <button key={l.id || 'auto'} role="menuitemradio" aria-checked={l.id === language} data-testid="language-option" className={item}
                    onClick={() => { setLanguage(l.id); prefs.setLanguage(l.id); setView('mics') }}>
                    <span className="flex-1">{l.label}</span>
                    {l.id === language && <Check size={14} className="shrink-0 text-ink" />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
