import { expect, it } from 'vitest'
import { updatesOn } from '../src/main/updates'

const installed = { packaged: true, fake: false, profile: false, platform: 'darwin' as NodeJS.Platform, appImage: false }

it('an installed Hob looks for new versions on Mac, Windows and Linux (AppImage)', () => {
  expect(updatesOn(installed)).toBe(true)
  expect(updatesOn({ ...installed, platform: 'win32' })).toBe(true)
  expect(updatesOn({ ...installed, platform: 'linux', appImage: true })).toBe(true)
})

it('never while developing, testing, on a separate profile, or on Linux outside an AppImage', () => {
  expect(updatesOn({ ...installed, packaged: false })).toBe(false)
  expect(updatesOn({ ...installed, fake: true })).toBe(false)
  expect(updatesOn({ ...installed, profile: true })).toBe(false)
  expect(updatesOn({ ...installed, platform: 'linux' })).toBe(false)
})
