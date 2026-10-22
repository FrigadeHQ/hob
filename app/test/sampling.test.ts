import { expect, it } from 'vitest'
import { samplingFor } from '../src/engine/sampling'

it('each model family gets the sampling its makers recommend; loops stay damped for all', () => {
  expect(samplingFor('gemma4')).toMatchObject({ temperature: 1, topP: 0.95, topK: 64 })
  expect(samplingFor('gpt-oss')).toMatchObject({ temperature: 1, topP: 1 })
  expect(samplingFor('qwen3')).toMatchObject({ temperature: 0.6, topP: 0.95, topK: 20 })
  // anything unknown: the careful settings
  expect(samplingFor(undefined)).toEqual(samplingFor('qwen3'))
  for (const a of ['gemma4', 'gpt-oss', 'qwen3']) expect(samplingFor(a).repeatPenalty).toBeTruthy()
})
