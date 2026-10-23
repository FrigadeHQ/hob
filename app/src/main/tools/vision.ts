import { execFile } from 'node:child_process'
import { mkdirSync, readFileSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { promisify } from 'node:util'
import { resolvePath, type Tool, type TurnCtx } from '../agent/tool'
import { runPython } from '../python/run'
import { t } from '../../shared/i18n'

/** what llama.cpp reads directly; other image types are converted to PNG first */
const DIRECT: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.bmp': 'image/bmp' }
const CONVERT = new Set(['.webp', '.heic', '.heif', '.tif', '.tiff', '.avif'])
const MAX_BYTES = 30 * 1024 * 1024

/** longest side sent to the vision model: a phone photo at full size is thousands of tokens and takes minutes */
export const MAX_SIDE = 768

/** pixel size from the file header (JPEG, PNG, GIF); undefined when it can't tell */
export function imageSize(buf: Buffer): { w: number; h: number } | undefined {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
  if (buf.length > 10 && buf.toString('latin1', 0, 3) === 'GIF') return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i + 9 < buf.length;) {
      if (buf[i] !== 0xff) { i++; continue }
      const m = buf[i + 1]
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) }
      i += 2 + buf.readUInt16BE(i + 2)
    }
  }
  return undefined
}

/**
 * A copy the vision model can read quickly: at most MAX_SIDE pixels on its longest side, as JPEG or PNG.
 * Converts iPhone photos (HEIC), WebP and TIFF too. macOS's sips where there is one, else Pillow in Hob's sandbox.
 * Small JPEGs and PNGs go as they are.
 */
async function readable(path: string, ctx: TurnCtx, maxSide = MAX_SIDE): Promise<string> {
  const ext = extname(path).toLowerCase()
  const size = DIRECT[ext] ? imageSize(readFileSync(path)) : undefined
  if (size && Math.max(size.w, size.h) <= maxSide) return path
  const dir = join(ctx.runTmp, 'images')
  mkdirSync(dir, { recursive: true })
  const out = join(dir, `${Date.now()}-${basename(path, extname(path))}.jpg`)
  if (process.platform === 'darwin') {
    await promisify(execFile)('/usr/bin/sips', ['-Z', String(maxSide), '-s', 'format', 'jpeg', path, '--out', out])
    return out
  }
  if (!ctx.python) throw new Error('Hob needs its code tools to open this kind of image.')
  const python = await ctx.python.ensure()
  const r = await runPython({ python, runtimeRoot: ctx.python.dir, cwd: dir, tmpDir: ctx.runTmp, readPaths: [path], timeoutMs: 60_000, signal: ctx.signal,
    code: `from PIL import Image, ImageOps\nim = ImageOps.exif_transpose(Image.open(${JSON.stringify(path)})).convert('RGB')\nim.thumbnail((${maxSide}, ${maxSide}))\nim.save(${JSON.stringify(out)}, quality=90)` })
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
  title: (a) => (a.path == null ? t('Looked at the image') : t('Looked at {name}', { name: basename(String(a.path)) })),
  action: (a, ctx) => ({ kind: 'read', paths: [resolvePath(ctx, String(a.path ?? ''))] }),
  async run(a, ctx) {
    const question = String(a.question ?? '').trim() || 'Describe this image in detail. Read out any text in it exactly.'
    return seeImage(resolvePath(ctx, String(a.path ?? '')), question, ctx)
  },
}

/**
 * Ask Hob's image model about an image file: photos, screenshots, and pages of PDFs that are pictures.
 * maxSide: a page of a document needs more pixels than a photo for its small print to stay readable.
 */
export async function seeImage(path: string, question: string, ctx: TurnCtx, maxSide = MAX_SIDE): Promise<{ text: string; failed?: boolean }> {
  const v = ctx.vision
  const s = v?.state()
  if (!v || !s || s.phase === 'off') return { text: "Hob can't see images yet: its image support downloads after the main model. Tell the user, and work from the file name or details only if they're enough.", failed: true }
  if (s.phase === 'downloading') return { text: `Hob's image support is still downloading (${Math.round(s.progress * 100)}%). Tell the user it'll be ready soon; you can't see the image yet.`, failed: true }
  if (s.phase === 'error') return { text: `Hob's image support couldn't be set up: ${s.message}`, failed: true }
  const ext = extname(path).toLowerCase()
  if (!DIRECT[ext] && !CONVERT.has(ext)) return { text: `${basename(path)} isn't an image Hob can look at (JPG, PNG, HEIC, WebP, GIF or TIFF).`, failed: true }
  if (statSync(path).size > MAX_BYTES) return { text: `${basename(path)} is too big to look at (over 30 MB).`, failed: true }
  ctx.progress?.(t('Looking at {name}…', { name: basename(path) }))
  const file = await readable(path, ctx, maxSide)
  const mime = DIRECT[extname(file).toLowerCase()] ?? 'image/jpeg'
  const answer = await v.ask(`data:${mime};base64,${readFileSync(file).toString('base64')}`, question, ctx.signal)
  return { text: answer || 'The image model had nothing to say about it.' }
}
