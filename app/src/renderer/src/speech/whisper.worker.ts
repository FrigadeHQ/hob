/// <reference lib="webworker" />
// Speech to text with Whisper, entirely on this computer (WebGPU when available, else WebAssembly).
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'
import ortMjs from 'ort-dist/ort-wasm-simd-threaded.asyncify.mjs?url'
import ortWasm from 'ort-dist/ort-wasm-simd-threaded.asyncify.wasm?url'

/** audio absent = just load the model (warm up while the user is still talking) */
/** language: Whisper's name for it ("english"); absent = it works it out */
export type WorkerIn = { id: number; audio?: Float32Array; modelBase?: string; language?: string }
export type WorkerOut = { id: number; text?: string; error?: string } | { progress: number }

const MODEL = 'onnx-community/whisper-base'
// runtime files ship with the app; never fetched from a CDN
if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = { mjs: ortMjs, wasm: ortWasm }

let asr: Promise<AutomaticSpeechRecognitionPipeline> | undefined

function load(modelBase?: string) {
  // model files come from Hob's own verified download, never straight from the internet; no second cache
  env.allowRemoteModels = false
  env.allowLocalModels = true
  env.useBrowserCache = false
  if (modelBase) env.localModelPath = modelBase
  const gpu = 'gpu' in navigator
  const files = new Map<string, number>()
  return (asr ??= pipeline('automatic-speech-recognition', MODEL, {
    device: gpu ? 'webgpu' : 'wasm',
    dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
    progress_callback: (p: { status: string; file?: string; progress?: number }) => {
      if (p.status !== 'progress' || !p.file) return
      files.set(p.file, p.progress ?? 0)
      self.postMessage({ progress: [...files.values()].reduce((a, b) => a + b, 0) / (files.size * 100) } satisfies WorkerOut)
    },
  }) as Promise<AutomaticSpeechRecognitionPipeline>)
}

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const { id, audio, modelBase, language } = e.data
  try {
    const asr = await load(modelBase)
    if (!audio) return self.postMessage({ id, text: '' } satisfies WorkerOut)
    const out = await asr(audio, { chunk_length_s: 30, stride_length_s: 5, ...(language ? { language, task: 'transcribe' } : {}) })
    const text = (Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text).trim()
    self.postMessage({ id, text } satisfies WorkerOut)
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) } satisfies WorkerOut)
  }
}
