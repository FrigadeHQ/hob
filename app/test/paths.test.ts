import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makePaths } from '../src/main/paths'

describe('makePaths', () => {
  it('keeps downloads in app data until another folder is picked, then everything big goes there, also after a restart', () => {
    const data = mkdtempSync(join(tmpdir(), 'hob-data-'))
    const drive = mkdtempSync(join(tmpdir(), 'hob-drive-'))
    const p = makePaths(data)
    expect([p.downloads, p.models, p.vision, p.speech]).toEqual([data, join(data, 'models'), join(data, 'vision'), join(data, 'speech')])

    p.setDownloads(drive)
    // a folder of its own, so it's clear what it is and removing Hob can take all of it
    const hob = join(drive, 'Hob')
    expect([p.downloads, p.models, p.vision, p.speech]).toEqual([hob, join(hob, 'models'), join(hob, 'vision'), join(hob, 'speech')])
    expect(makePaths(data).models).toBe(join(hob, 'models'))
    // chats and settings stay put
    expect(p.db).toBe(join(data, 'hob.db'))
  })
})
