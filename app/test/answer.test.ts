import { describe, expect, it } from 'vitest'
import { finalAnswer } from '../src/engine/answer'

describe('finalAnswer', () => {
  it('uses the response when the model answered normally', () => {
    expect(finalAnswer('\n\npong', 'Okay, the user wants pong.')).toBe('pong')
  })
  it('recovers an answer trapped after a stray </think> in the thought text', () => {
    expect(finalAnswer('', '</think>\n\npong')).toBe('pong')
  })
  it('takes text after the last </think> only', () => {
    expect(finalAnswer('', 'plan </think> draft </think> final')).toBe('final')
  })
  it('returns empty string when there is nothing to recover', () => {
    expect(finalAnswer('', 'just thinking, no close tag')).toBe('')
  })
})
