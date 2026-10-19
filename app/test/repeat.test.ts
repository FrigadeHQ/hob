import { expect, it } from 'vitest'
import { repeatCut } from '../src/main/agent/repeat'

const para = "I've checked the first batch of names, and most are taken. Let's try a fresh batch of unique made-up names: Zylo, Kora, Vexi, Qub, Jaxo. Let me search for these new ones.\n\n"

it('finds where a long passage starts repeating word for word', () => {
  const text = 'Intro. ' + para + para
  expect(repeatCut(text)).toBe(('Intro. ' + para).length)
})
it('leaves normal text alone, including short repeated phrases and lists', () => {
  expect(repeatCut('Intro. ' + para)).toBe(-1)
  expect(repeatCut('- Read the file\n- Read the file\n- Read the file\n')).toBe(-1)
  expect(repeatCut('')).toBe(-1)
})
