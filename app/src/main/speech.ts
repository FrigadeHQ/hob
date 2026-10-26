import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { RuntimeDeps } from './python/runtime'

/** Whisper base (multilingual), pinned to one Hugging Face revision; every file checksummed. */
export const WHISPER = {
  id: 'onnx-community/whisper-base',
  revision: '1846881b6b3a3024392c1eea3ad983695bc23925',
  files: [
    { path: 'config.json', sha256: 'f4d0608f7d918166da7edb3e188de5ef1bfe70d9802e785d271fd88111e9cf4b', bytes: 2243 },
    { path: 'generation_config.json', sha256: '61070cf8de25b1e9256e8e102ded49d8d24a8369ed36ef84fdf21549e68125a0', bytes: 3832 },
    { path: 'preprocessor_config.json', sha256: 'a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d', bytes: 339 },
    { path: 'tokenizer_config.json', sha256: '2e036e4dbacfdeb7242c7d4ec4149f4a16e86026048f94d1637e3a8ee9c6a573', bytes: 282682 },
    { path: 'tokenizer.json', sha256: '27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566', bytes: 2480466 },
    { path: 'onnx/encoder_model.onnx', sha256: 'a9f3b752833b49e880dec91ee5b6d936112be7c3ea07c221024ba493439f46fe', bytes: 82468078 },
    { path: 'onnx/decoder_model_merged_q4.onnx', sha256: '09f83b71ceedc97dab1d90b914715dc532a646a147abda11d83c64867b7c319c', bytes: 123602419 },
  ],
}
const TOTAL = WHISPER.files.reduce((s, f) => s + f.bytes, 0)
const MARKER = 'ready.json'

/** The dictation model, downloaded once into app data after the main model (or when dictation is first used). */
export class SpeechModel {
  private installing: Promise<void> | undefined
  /** everyone waiting for the download: it may have started in the background before dictation was clicked */
  private watchers = new Set<(fraction: number) => void>()
  constructor(private root: string, private deps: Pick<RuntimeDeps, 'fetchFile'>) {}

  /** folder transformers.js loads `${id}/${file}` from */
  get dir() { return this.root }

  isReady() {
    try { return JSON.parse(readFileSync(join(this.root, MARKER), 'utf8')).revision === WHISPER.revision } catch { return false }
  }

  ensure(onProgress: (fraction: number) => void = () => {}): Promise<void> {
    if (this.isReady()) return Promise.resolve()
    this.watchers.add(onProgress)
    this.installing ??= this.install().finally(() => { this.installing = undefined; this.watchers.clear() })
    return this.installing
  }

  private async install() {
    const onProgress = (f: number) => { for (const w of this.watchers) w(f) }
    let done = 0
    for (const f of WHISPER.files) {
      const dest = join(this.root, WHISPER.id, f.path)
      if (!existsSync(dest)) {
        const url = `https://huggingface.co/${WHISPER.id}/resolve/${WHISPER.revision}/${f.path}`
        await this.deps.fetchFile(url, f.sha256, f.bytes / 1e9, dirname(dest), (p) => onProgress((done + p * f.bytes) / TOTAL), f.path.split('/').pop())
      }
      done += f.bytes
      onProgress(done / TOTAL)
    }
    writeFileSync(join(this.root, MARKER), JSON.stringify({ revision: WHISPER.revision }))
  }
}

/** macOS microphone permission: show the system prompt the first time; never nag after a "no". */
export async function micAccess(status: string, ask: () => Promise<boolean>): Promise<boolean> {
  if (status === 'granted') return true
  if (status === 'not-determined') return ask()
  return false
}
