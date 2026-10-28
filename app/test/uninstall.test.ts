import { describe, expect, it } from 'vitest'
import { removalPlan } from '../src/main/uninstall'

const base = { packaged: true, profile: false, appImage: undefined, data: '/Users/sam/Library/Application Support/Hob' }

describe('removalPlan', () => {
  it('on a Mac, deletes the data and moves Hob.app to the Trash', () => {
    expect(removalPlan({ ...base, platform: 'darwin', execPath: '/Applications/Hob.app/Contents/MacOS/Hob' }))
      .toEqual({ data: base.data, app: '/Applications/Hob.app' })
  })

  it('on Windows, runs Hob’s own uninstaller, which also deletes the data', () => {
    expect(removalPlan({ ...base, platform: 'win32', data: 'C:\\Users\\sam\\AppData\\Roaming\\Hob', execPath: 'C:\\Users\\sam\\AppData\\Local\\Programs\\hob\\Hob.exe' }))
      .toEqual({ uninstaller: 'C:\\Users\\sam\\AppData\\Local\\Programs\\hob\\Uninstall Hob.exe' })
  })

  it('on Linux, deletes the data and the AppImage', () => {
    expect(removalPlan({ ...base, platform: 'linux', data: '/home/sam/.config/Hob', execPath: '/tmp/.mount_HobXYZ/hob', appImage: '/home/sam/Apps/Hob-linux-x86_64.AppImage' }))
      .toEqual({ data: '/home/sam/.config/Hob', app: '/home/sam/Apps/Hob-linux-x86_64.AppImage' })
  })

  it('in development or a separate profile, deletes only the data, never the app', () => {
    expect(removalPlan({ ...base, packaged: false, platform: 'win32', execPath: 'C:\\dev\\electron.exe' })).toEqual({ data: base.data })
    expect(removalPlan({ ...base, profile: true, platform: 'darwin', execPath: '/Applications/Hob.app/Contents/MacOS/Hob' })).toEqual({ data: base.data })
  })
})
