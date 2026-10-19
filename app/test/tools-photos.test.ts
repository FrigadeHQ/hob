import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { Journal } from '../src/main/agent/journal'
import type { TurnCtx } from '../src/main/agent/tool'
import type { PythonRuntime } from '../src/main/python/runtime'
import { photoInfo } from '../src/main/tools/photos'

// Hob's own Python (with Pillow), when it's installed on this machine
const root = join(homedir(), 'Library', 'Application Support', 'Hob', 'python')
const python = join(root, 'python', 'bin', 'python3')

it.skipIf(!existsSync(python))('photo_info reads the date taken from EXIF, not the file date', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hob-photos-'))
  const chatDir = join(dir, 'chat'); const photos = join(dir, 'hob-test')
  mkdirSync(chatDir); mkdirSync(photos)
  execFileSync(python, ['-I', '-c', `
import sys
from PIL import Image
ex = Image.Exif(); ex[271] = 'Apple'; ex[272] = 'iPhone 13'; ex.get_ifd(0x8769)[36867] = '2023:03:08 14:22:01'
Image.new('RGB', (40, 30)).save(sys.argv[1] + '/IMG_8614.jpg', exif=ex)
Image.new('RGB', (10, 10)).save(sys.argv[1] + '/screenshot.png')
`, photos])
  writeFileSync(join(photos, 'notes.txt'), 'not a photo')
  const ctx = {
    chatDir, grants: [photos], signal: new AbortController().signal, untrusted: false, webAccess: false,
    journal: new Journal({ backupDir: join(dir, 'undo'), save: () => {} }), trash: async () => {},
    python: { isReady: () => true, ensure: async () => python, dir: root } as unknown as PythonRuntime,
    runTmp: join(dir, 'tmp'), fetch: globalThis.fetch,
  } satisfies TurnCtx
  const out = await photoInfo.run({ path: photos }, ctx)
  expect(out.failed).toBeFalsy()
  expect(out.text).toContain('IMG_8614.jpg: taken 2023-03-08 14:22:01, 40x30, Apple iPhone 13')
  expect(out.text).toContain('screenshot.png: no date taken (not in the photo)')
  expect(out.text).not.toContain('notes.txt')
  expect(photoInfo.action({ path: photos }, ctx)).toEqual({ kind: 'read', paths: [photos] })
})
