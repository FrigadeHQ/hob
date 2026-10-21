/**
 * Mabel's "eyes": a small vision model that looks at an image and says what's in it, for whatever main model is
 * running. Qwen3-VL (Apache-2.0) at one pinned revision, and llama.cpp's own server at one pinned build
 * (≥2 weeks old when pinned); every file checksummed.
 */
const HF = (repo: string, rev: string, file: string) => `https://huggingface.co/${repo}/resolve/${rev}/${file}`

export type VisionFile = { url: string; sha256: string; bytes: number }
export type VisionModel = { id: string; name: string; model: VisionFile; mmproj: VisionFile }

const R4 = '1cd86afb9a95c410a6038ab3b40d8b578c892266'
const R2 = '52d6c8ffea26cc873ac5ad116f8631268d7eb503'
export const VISION_MODELS: Record<'4b' | '2b', VisionModel> = {
  '4b': {
    id: 'qwen3-vl-4b', name: 'Qwen3-VL 4B',
    model: { url: HF('Qwen/Qwen3-VL-4B-Instruct-GGUF', R4, 'Qwen3VL-4B-Instruct-Q4_K_M.gguf'), sha256: '66358cb18bb6b3b1b6675aa412c7a88ef01d228f481184d13668e5201c730a0a', bytes: 2497281664 },
    mmproj: { url: HF('Qwen/Qwen3-VL-4B-Instruct-GGUF', R4, 'mmproj-Qwen3VL-4B-Instruct-Q8_0.gguf'), sha256: '30ba2c7dd3127a4561b6cba9d13d0f711c91bdb38742e2f56d73c8cb596bd06d', bytes: 453974304 },
  },
  '2b': {
    id: 'qwen3-vl-2b', name: 'Qwen3-VL 2B',
    model: { url: HF('Qwen/Qwen3-VL-2B-Instruct-GGUF', R2, 'Qwen3VL-2B-Instruct-Q4_K_M.gguf'), sha256: '089d75c52f4b7ffc56ba998ffc50aae89fcafc755f9e7208aacca281dca6c2ae', bytes: 1107409952 },
    mmproj: { url: HF('Qwen/Qwen3-VL-2B-Instruct-GGUF', R2, 'mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf'), sha256: 'f9a68fabba69c3b81e153367b2c7521030b0fa8bb0de400c9599c8e6725f9c82', bytes: 445053216 },
  },
}

/**
 * The 4B one when it fits on the graphics chip next to the main model (about 5 s an image); otherwise the 2B one,
 * which runs half on the CPU in 10–20 s where the 4B one takes 25–40 s.
 */
export function pickVision(o: { totalRamGB: number; unified: boolean; vramGB?: number; mainModelGB: number }): VisionModel {
  return visionFitsGpu({ ...o, visionGB: VISION_GB['4b'] }) ? VISION_MODELS['4b'] : VISION_MODELS['2b']
}

export const SERVER_BUILD = 'b11433'
const GH = (file: string) => `https://github.com/ggml-org/llama.cpp/releases/download/${SERVER_BUILD}/${file}`
/** Mac: Metal. Windows and Linux: Vulkan (any graphics card), with a plain CPU build to fall back to. */
export const SERVER_FILES: Record<string, { gpu: VisionFile; cpu?: VisionFile }> = {
  'darwin-arm64': { gpu: { url: GH(`llama-${SERVER_BUILD}-bin-macos-arm64.tar.gz`), sha256: '5e7b2383009facb31404f308cdb9edd1fb15131330801408fb582bd05e188f97', bytes: 11971372 } },
  'darwin-x64': { gpu: { url: GH(`llama-${SERVER_BUILD}-bin-macos-x64.tar.gz`), sha256: 'caaadcff99ce696bbb6a1ef6f7c0050250fe60d8448464ee7c90878cde3a5370', bytes: 11487490 } },
  'linux-x64': {
    gpu: { url: GH(`llama-${SERVER_BUILD}-bin-ubuntu-vulkan-x64.tar.gz`), sha256: '1243a90945de3644f86bc98b588c9f7664c8528cf925b184671df060e8334d1f', bytes: 31636263 },
    cpu: { url: GH(`llama-${SERVER_BUILD}-bin-ubuntu-x64.tar.gz`), sha256: 'd6ff12a557793e302ddbba9660a0f045c403e2f67ab5dcdc1254b343c560c015', bytes: 17693586 },
  },
  'win32-x64': {
    gpu: { url: GH(`llama-${SERVER_BUILD}-bin-win-vulkan-x64.zip`), sha256: '021001e2b7a60aab1d23b301edb2f076e8a5136d8d29686d0d95341342088714', bytes: 33337778 },
    cpu: { url: GH(`llama-${SERVER_BUILD}-bin-win-cpu-x64.zip`), sha256: '301943380e45deae3991d42dddd03fae65c6a4963a5d882328a60208b43aa9e0', bytes: 19399521 },
  },
}

export const visionBytes = (m: VisionModel, server?: VisionFile) => m.model.bytes + m.mmproj.bytes + (server?.bytes ?? 0)
/** memory each needs while running: files plus working room */
export const VISION_GB = { '4b': 3.5, '2b': 2 } as const
export const visionGB = (m: VisionModel) => (m.id === VISION_MODELS['4b'].id ? VISION_GB['4b'] : VISION_GB['2b'])

/**
 * Can the vision model sit fully on the graphics chip next to the main model? Macs share memory, and the
 * graphics side gets about three quarters of it; a graphics card has its own. Both models need room to work
 * on top of their files, so leave some. When it doesn't fit, the vision model's text half runs on the CPU
 * (its image reader stays on the graphics chip): slower, but it no longer starves the main model.
 */
export function visionFitsGpu(o: { totalRamGB: number; unified: boolean; vramGB?: number; mainModelGB: number; visionGB: number }): boolean {
  const budget = o.unified ? o.totalRamGB * 0.75 : (o.vramGB ?? 0) * 0.9
  return o.mainModelGB + o.visionGB + 3 <= budget
}
