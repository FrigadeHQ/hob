/**
 * Sampling as each model's makers recommend it. Greedy decoding (the default) made long agent turns fall
 * into word-for-word loops, so every family keeps a little randomness and a presence penalty.
 */
const LOOPS = { repeatPenalty: { lastTokens: 256, penalty: 1.05, presencePenalty: 0.5 } } as const
// Qwen's thinking-mode settings; also the careful choice for anything unknown
const QWEN = { temperature: 0.6, topP: 0.95, topK: 20, minP: 0, ...LOOPS }
const BY_ARCH: Record<string, typeof QWEN> = {
  gemma4: { temperature: 1, topP: 0.95, topK: 64, minP: 0, ...LOOPS },
  'gpt-oss': { temperature: 1, topP: 1, topK: 0, minP: 0, ...LOOPS },
}

/** arch: the model file's architecture (general.architecture), e.g. "gemma4", "gpt-oss", "qwen3" */
export const samplingFor = (arch: string | undefined) => (arch && BY_ARCH[arch]) || QWEN
