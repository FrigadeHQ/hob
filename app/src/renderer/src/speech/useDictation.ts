import { useCallback, useEffect, useRef, useState } from 'react'
import { hob } from '../api'
import { startRecording } from './record'
import { prefs } from './prefs'

type Prepared = Awaited<ReturnType<typeof hob.speech.prepare>>

/**
 * Mic button behaviour: first press records, second press transcribes on this computer and hands
 * the text over. The dictation model downloads (once) while the user is still talking.
 */
export function useDictation(onText: (text: string) => void) {
  const [state, setState] = useState<'idle' | 'listening' | 'transcribing'>('idle')
  const [progress, setProgress] = useState<number | null>(null)
  /** micSettings: offer a button that opens the system's microphone settings */
  const [error, setError] = useState<{ text: string; micSettings?: boolean } | null>(null)
  const recording = useRef<Awaited<ReturnType<typeof startRecording>> | null>(null)
  const prepared = useRef<Promise<Prepared> | null>(null)

  useEffect(() => hob.speech.onProgress((f) => setProgress(f < 1 ? f : null)), [])
  useEffect(() => () => recording.current?.cancel(), [])

  async function start() {
    setError(null)
    // the system prompt appears here the first time; after a "no", point to Settings
    if (!(await hob.speech.mic())) return setError({ text: 'Hob needs microphone access for dictation.', micSettings: true })
    if (!prepared.current) {
      prepared.current = hob.speech.prepare()
      prepared.current.catch(() => { prepared.current = null })
      // load the model while the user talks (first use of a session takes a while)
      void prepared.current.then(async (r) => { if ('modelBase' in r) (await import('./index')).warm(r.modelBase) }).catch(() => {})
    }
    try {
      recording.current = hob.fake ? null : await startRecording(prefs.mic())
      setState('listening')
    } catch (err) {
      console.error(err)
      const name = (err as Error).name
      setError(name === 'NotAllowedError' || name === 'SecurityError'
        ? { text: 'Hob needs microphone access for dictation.', micSettings: true }
        : { text: name === 'NotFoundError' ? 'No microphone found.' : "Couldn't start the microphone. Try again." })
    }
  }

  /** stop without turning anything into text */
  function cancel() {
    if (state !== 'listening') return
    recording.current?.cancel()
    recording.current = null
    setState('idle')
  }

  /** how loud the mic is right now, 0–1; a gentle made-up voice in test mode */
  const level = useCallback(() => recording.current?.level() ?? (hob.fake ? Math.abs(0.6 * Math.sin(Date.now() / 180) * Math.sin(Date.now() / 530)) : 0), [])

  async function finish() {
    setState('transcribing')
    try {
      const audio = await recording.current?.stop()
      const ready = await prepared.current!
      if ('fake' in ready) return onText('Hello from dictation')
      const { toPcm, transcribe } = await import('./index')
      const text = audio ? await transcribe(await toPcm(audio), { modelBase: ready.modelBase, language: prefs.language() || undefined }) : ''
      if (text) onText(text)
    } catch (err) {
      console.error(err)
      setError({ text: "Couldn't turn that into text. Try again." })
    } finally {
      recording.current = null
      setProgress(null)
      setState('idle')
    }
  }

  const hint = state === 'listening' ? 'Listening…'
    : state === 'transcribing' ? (progress !== null ? `Getting dictation ready… ${Math.round(progress * 100)}%` : 'Turning speech into text…')
    : undefined

  return {
    listening: state === 'listening', busy: state === 'transcribing', hint, error, level, cancel,
    toggle: () => void (state === 'idle' ? start() : state === 'listening' ? finish() : undefined),
  }
}
