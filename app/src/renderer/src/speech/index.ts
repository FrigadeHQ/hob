import type { WorkerIn, WorkerOut } from './whisper.worker'

const RATE = 16_000
let worker: Worker | undefined
let nextId = 1
const waiting = new Map<number, { resolve(t: string): void; reject(e: Error): void }>()
let onProgress: ((f: number) => void) | undefined

function getWorker() {
  if (worker) return worker
  worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<WorkerOut>) => {
    const m = e.data
    if ('progress' in m) return onProgress?.(m.progress)
    const w = waiting.get(m.id)
    waiting.delete(m.id)
    if (m.error) w?.reject(new Error(m.error)); else w?.resolve(m.text ?? '')
  }
  return worker
}

/** Any recorded/encoded audio → 16 kHz mono samples, which Whisper expects. */
export async function toPcm(bytes: ArrayBuffer): Promise<Float32Array> {
  const decoded = await new AudioContext().decodeAudioData(bytes)
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * RATE), RATE)
  const src = off.createBufferSource()
  src.buffer = decoded
  src.connect(off.destination)
  src.start()
  return (await off.startRendering()).getChannelData(0)
}

export function transcribe(audio: Float32Array, o: { modelBase?: string; language?: string; onProgress?: (f: number) => void } = {}): Promise<string> {
  onProgress = o.onProgress
  const id = nextId++
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject })
    getWorker().postMessage({ id, audio, modelBase: o.modelBase, ...(o.language ? { language: o.language } : {}) } satisfies WorkerIn, [audio.buffer])
  })
}

/** Load the model now so transcribing is quick when the user stops talking. */
export function warm(modelBase: string) {
  const id = nextId++
  waiting.set(id, { resolve: () => {}, reject: () => {} })
  getWorker().postMessage({ id, modelBase } satisfies WorkerIn)
}
