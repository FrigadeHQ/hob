import { execFile } from 'node:child_process'
import { mkdirSync, readFileSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { promisify } from 'node:util'
import { resolvePath, type Tool, type TurnCtx } from '../agent/tool'
import { runPython } from '../python/run'

/** what llama.cpp reads directly; other image types are converted to PNG first */
const DIRECT: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.bmp': 'image/bmp' }
const CONVERT = new Set(['.webp', '.heic', '.heif', '.tif', '.tiff', '.avif'])
const MAX_BYTES = 30 * 1024 * 1024

/** iPhone photos (HEIC), WebP and TIFF → PNG: macOS's sips where there is one, else Pillow in Hob's sandbox */
async function toPng(path: string, ctx: TurnCtx): Promise<string> {
  const dir = join(ctx.runTmp, 'images')
  mkdirSync(dir, { recursive: true })
  const out = join(dir, `${Date.now()}-${basename(path, extname(path))}.png`)
  if (process.platform === 'darwin') {
    await promisify(execFile)('/usr/bin/sips', ['-s', 'format', 'png', path, '--out', out])
    return out
  }
  if (!ctx.python) throw new Error('Hob needs its code tools to open this kind of image.')
  const python = await ctx.python.ensure()
  const r = await runPython({ python, runtimeRoot: ctx.python.dir, cwd: dir, tmpDir: ctx.runTmp, readPaths: [path], timeoutMs: 60_000, signal: ctx.signal,
    code: `from PIL import Image\nImage.open(${JSON.stringify(path)}).convert('RGB').save(${JSON.stringify(out)})` })
  if (r.exitCode !== 0) throw new Error(`Couldn't open this image: ${r.output.split('\n').filter(Boolean).at(-1) ?? ''}`)
  return out
}

/** Hob's eyes: a small vision model looks at the image and answers in words; the main model does the rest. */
export const lookAtImage: Tool<{ path: string; question?: string }> = {
  spec: {
    name: 'look_at_image',
    description: "See what's in a photo, screenshot or other image: describe it, read text in it (receipts, screenshots, charts), or answer a question about it. Pass the image's path and what you want to know.",
    params: { type: 'object', properties: {
      path: { type: 'string', description: 'The image file' },
      question: { type: 'string', description: 'What to find out, e.g. "What is the total on this receipt?". Leave out to get a description.' },
    }, required: ['path'] },
  },
  title: (a) => `Looked at ${basename(String(a.path ?? 'the image'))}`,
  action: (a, ctx) => ({ kind: 'read', paths: [resolvePath(ctx, String(a.path ?? ''))] }),
  async run(a, ctx) {
    const v = ctx.vision
    const s = v?.state()
    if (!v || !s || s.phase === 'off') return { text: "Hob can't see images yet: its image support downloads after the main model. Tell the user, and work from the file name or details only if they're enough.", failed: true }
    if (s.phase === 'downloading') return { text: `Hob's image support is still downloading (${Math.round(s.progress * 100)}%). Tell the user it'll be ready soon; you can't see the image yet.`, failed: true }
    if (s.phase === 'error') return { text: `Hob's image support couldn't be set up: ${s.message}`, failed: true }
    const path = resolvePath(ctx, String(a.path ?? ''))
    const ext = extname(path).toLowerCase()
    if (!DIRECT[ext] && !CONVERT.has(ext)) return { text: `${basename(path)} isn't an image Hob can look at (JPG, PNG, HEIC, WebP, GIF or TIFF).`, failed: true }
    if (statSync(path).size > MAX_BYTES) return { text: `${basename(path)} is too big to look at (over 30 MB).`, failed: true }
    ctx.progress?.(`Looking at ${basename(path)}…`)
    const file = DIRECT[ext] ? path : await toPng(path, ctx)
    const mime = DIRECT[extname(file).toLowerCase()] ?? 'image/png'
    const question = String(a.question ?? '').trim() || 'Describe this image in detail. Read out any text in it exactly.'
    const answer = await v.ask(`data:${mime};base64,${readFileSync(file).toString('base64')}`, question, ctx.signal)
    return { text: answer || 'The image model had nothing to say about it.' }
  },
}
