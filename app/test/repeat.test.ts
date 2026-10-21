import { expect, it } from 'vitest'
import { repeatCut } from '../src/main/agent/repeat'

const para = "I've checked the first batch of names, and most are taken. Let's try a fresh batch of unique made-up names: Zylo, Kora, Vexi, Qub, Jaxo. Let me search for these new ones.\n\n"

it('finds where a long passage starts repeating word for word, over and over', () => {
  const text = 'Intro. ' + para + para + para
  expect(repeatCut(text)).toBe(('Intro. ' + para).length)
  // twice is not yet a loop: real answers repeat a block now and then
  expect(repeatCut('Intro. ' + para + para)).toBe(-1)
})
it("a calendar with the same meetings every day isn't a loop", () => {
  const day = (d: string) => `**${d}**\n\n| Time | Event |\n|---|---|\n| 08:00–11:00 | Block – Morning Focus (Eric's calendar) |\n| 10:00–10:50 | Stand-up (Zoom link: https://zoom.us/j/97410263985?pwd=clkrbld3M285L29rU0wxeW16OUM5UT09) |\n| 12:00–13:00 | Block – Lunch (Eric's calendar) |\n\n`
  const text = 'Here is your week.\n\n' + ['Tuesday 20', 'Wednesday 21', 'Thursday 22', 'Friday 23'].map(day).join('')
  for (let n = 200; n <= text.length; n += 7) expect(repeatCut(text.slice(0, n))).toBe(-1)
})
it('leaves normal text alone, including short repeated phrases and lists', () => {
  expect(repeatCut('Intro. ' + para)).toBe(-1)
  expect(repeatCut('- Read the file\n- Read the file\n- Read the file\n')).toBe(-1)
  expect(repeatCut('')).toBe(-1)
})
