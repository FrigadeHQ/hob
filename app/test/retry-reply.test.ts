import { expect, it } from 'vitest'
import { FAILED, NO_ANSWER, REPEATING, failedReply } from '../src/shared/replies'

it('a reply that went wrong can be tried again; a real answer or a stop cannot', () => {
  expect(failedReply(FAILED)).toBe(true)
  expect(failedReply(NO_ANSWER)).toBe(true)
  expect(failedReply(`Here is the start\n\n${REPEATING}`)).toBe(true)
  expect(failedReply('Paris is the capital of France.')).toBe(false)
  expect(failedReply('Half an answer\n\n*Stopped.*')).toBe(false)
  expect(failedReply('')).toBe(false)
})
