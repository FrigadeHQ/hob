/** Record from the microphone until stop(); returns the encoded audio. level() is the live loudness, 0–1, for the waveform. */
export async function startRecording(): Promise<{ stop(): Promise<ArrayBuffer>; cancel(): void; level(): number }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
  const rec = new MediaRecorder(stream)
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => chunks.push(e.data)
  rec.start()
  // loudness for the waveform; recording works without it
  let ctx: AudioContext | undefined
  let analyser: AnalyserNode | undefined
  try {
    ctx = new AudioContext()
    analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    ctx.createMediaStreamSource(stream).connect(analyser)
  } catch { /* no waveform */ }
  const samples = new Float32Array(512)
  const release = () => { stream.getTracks().forEach((t) => t.stop()); void ctx?.close().catch(() => {}) }
  return {
    stop: () => new Promise((resolve) => {
      rec.onstop = () => { release(); void new Blob(chunks, { type: rec.mimeType }).arrayBuffer().then(resolve) }
      rec.stop()
    }),
    cancel: () => { rec.onstop = release; rec.stop() },
    level: () => {
      if (!analyser) return 0
      analyser.getFloatTimeDomainData(samples)
      let sum = 0
      for (const s of samples) sum += s * s
      // speech RMS is roughly 0.01–0.2: spread it over 0–1
      return Math.min(1, Math.sqrt(sum / samples.length) * 6)
    },
  }
}
