import { describe, expect, it } from 'vitest'
import { removalPlan } from '../src/main/uninstall'

const base = { packaged: true, profile: false, appImage: undefined, data: '/Users/sam/Library/Application Support/Hob' }
const win = { ...base, platform: 'win32' as const, data: 'C:\\Users\\sam\\AppData\\Roaming\\Hob', downloads: 'C:\\Users\\sam\\AppData\\Roaming\\Hob', execPath: 'C:\\Users\\sam\\AppData\\Local\\Programs\\hob\\Hob.exe' }

describe('removalPlan', () => {
  it('on a Mac, deletes the data and moves Hob.app to the Trash', () => {
    expect(removalPlan({ ...base, downloads: base.data, platform: 'darwin', execPath: '/Applications/Hob.app/Contents/MacOS/Hob' }))
      .toEqual({ folders: [base.data], app: '/Applications/Hob.app' })
  })

  it('on Windows, runs Hob’s own uninstaller, which also deletes the data', () => {
    expect(removalPlan(win)).toEqual({ folders: [], uninstaller: 'C:\\Users\\sam\\AppData\\Local\\Programs\\hob\\Uninstall Hob.exe' })
  })

  it('models saved on another drive go too (the uninstaller only knows app data)', () => {
    expect(removalPlan({ ...win, downloads: 'D:\\Hob' })).toEqual({ folders: ['D:\\Hob'], uninstaller: 'C:\\Users\\sam\\AppData\\Local\\Programs\\hob\\Uninstall Hob.exe' })
    expect(removalPlan({ ...base, platform: 'linux', data: '/home/sam/.config/Hob', downloads: '/mnt/big/Hob', execPath: '/tmp/.mount_HobXYZ/hob', appImage: '/home/sam/Apps/Hob.AppImage' }))
      .toEqual({ folders: ['/home/sam/.config/Hob', '/mnt/big/Hob'], app: '/home/sam/Apps/Hob.AppImage' })
  })

  it('on Linux, deletes the data and the AppImage', () => {
    expect(removalPlan({ ...base, platform: 'linux', data: '/home/sam/.config/Hob', downloads: '/home/sam/.config/Hob', execPath: '/tmp/.mount_HobXYZ/hob', appImage: '/home/sam/Apps/Hob-linux-x86_64.AppImage' }))
      .toEqual({ folders: ['/home/sam/.config/Hob'], app: '/home/sam/Apps/Hob-linux-x86_64.AppImage' })
  })

  it('in development or a separate profile, deletes only the data, never the app', () => {
    expect(removalPlan({ ...win, packaged: false, execPath: 'C:\\dev\\electron.exe' })).toEqual({ folders: [win.data] })
    expect(removalPlan({ ...base, downloads: base.data, profile: true, platform: 'darwin', execPath: '/Applications/Hob.app/Contents/MacOS/Hob' })).toEqual({ folders: [base.data] })
  })
})
