import { statSync } from 'node:fs'
import { basename } from 'node:path'
import { runPython } from '../python/run'
import { resolvePath, type Tool } from '../agent/tool'
import { ensurePython } from './python'

const MAX_PHOTOS = 500

/** prints one line per image: name, date taken (from EXIF), size, camera */
const PHOTO_PY = `
import os, sys
from PIL import Image
p = PATH
exts = ('.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp', '.heic', '.heif', '.gif', '.bmp')
names = sorted(n for n in os.listdir(p) if n.lower().endswith(exts) and not n.startswith('.')) if os.path.isdir(p) else [os.path.basename(p)]
folder = p if os.path.isdir(p) else os.path.dirname(p)
print(f'Folder: {folder}')
for n in names[:MAX]:
    try:
        with Image.open(os.path.join(folder, n)) as img:
            ex = img.getexif()
            sub = ex.get_ifd(0x8769)
            taken = sub.get(36867) or sub.get(36868)
            when = f'taken {taken[:10].replace(":", "-")} {taken[11:19]}' if taken else 'no date taken (not in the photo)'
            camera = ' '.join(str(x).strip() for x in (ex.get(271), ex.get(272)) if x)
            print(f'{n}: {when}, {img.width}x{img.height}' + (f', {camera}' if camera else ''))
    except Exception as e:
        kind = 'HEIC photos' if n.lower().endswith(('.heic', '.heif')) else 'this file'
        print(f"{n}: can't read {kind} ({type(e).__name__})")
if len(names) > MAX:
    print(f'... and {len(names) - MAX} more')
if not names:
    print('(no images here)')
`

export const photoInfo: Tool<{ path: string }> = {
  spec: {
    name: 'photo_info',
    description: "List the photos in a folder (or one photo) with the date each was taken, its size and camera, read from the photo's EXIF data. Use this for anything about when photos were taken; a file's modified date is not that.",
    params: { type: 'object', properties: { path: { type: 'string', description: 'A folder or an image file' } }, required: ['path'] },
  },
  title: (a) => `Read photo dates in ${basename(a.path)}`,
  action: (a, ctx) => ({ kind: 'read', paths: [resolvePath(ctx, a.path)] }),
  async run(a, ctx) {
    const p = resolvePath(ctx, a.path)
    statSync(p) // a clear "no such file" before starting Python
    const python = await ensurePython(ctx)
    const r = await runPython({
      python, runtimeRoot: ctx.python!.dir, cwd: ctx.chatDir, tmpDir: ctx.runTmp, signal: ctx.signal, timeoutMs: 120_000,
      readPaths: ctx.grants, code: `PATH = ${JSON.stringify(p)}\nMAX = ${MAX_PHOTOS}\n${PHOTO_PY}`,
    })
    if (r.exitCode !== 0) return { text: `Couldn't read the photos:\n${r.output}`, detail: r.output, failed: true }
    return { text: r.output.trim(), detail: r.output.trim() }
  },
}
