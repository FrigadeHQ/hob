import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { resolvePath, type Tool, type TurnCtx } from '../agent/tool'

/**
 * PDFs, including scanned ones: Hob's PDF helper (native/hob-pdf, Apple PDFKit + Vision) reads the text,
 * recognizes it on scanned pages, finds the blanks of a form, and writes answers onto a copy.
 */
export type PdfLine = { t: string; x: number; y: number; w: number; h: number }
export type PdfBlank = { x: number; y: number; w: number; h: number; kind: 'line' | 'box' }
export type PdfPage = { n: number; width: number; height: number; ocr: boolean; lines: PdfLine[]; blanks: PdfBlank[] }
export type PdfField = { name: string; type: 'text' | 'checkbox' | 'radio' | 'choice' | 'signature'; value: string; options?: string[]; page: number; x: number; y: number; w: number; h: number }
export type PdfRead = { pageCount: number; pages: PdfPage[]; fields: PdfField[] }
export type Labeled = PdfBlank & { id: string; page: number; label: string }

const MAX_PAGES = 40

/** the helper next to the app (packaged), or built into resources/bin (development and tests) */
export function pdfHelper(): string {
  const candidates = [
    process.env.HOB_PDF_HELPER,
    process.resourcesPath && join(process.resourcesPath, 'bin', 'hob-pdf'),
    join(__dirname, '../../resources/bin/hob-pdf'),
    join(__dirname, '../../../resources/bin/hob-pdf'),
  ].filter((x): x is string => !!x)
  return candidates.find((c) => existsSync(c)) ?? candidates.at(-1)!
}

export function runHelper(args: string[], signal?: AbortSignal): Promise<PdfRead> {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'darwin' || !existsSync(pdfHelper())) return reject(new Error("Reading PDFs this way isn't available on this computer yet."))
    execFile(pdfHelper(), args, { maxBuffer: 64 * 1024 * 1024, timeout: 180_000, signal }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr.trim() || (signal?.aborted ? 'Stopped by the user.' : err.message)))
      try { resolve(JSON.parse(stdout)) } catch { reject(new Error('The PDF helper gave an answer Hob could not read.')) }
    })
  })
}

// the same file read twice in a task (read, then fill) isn't recognized twice
const cache = new Map<string, Promise<PdfRead>>()
function analyze(path: string, signal?: AbortSignal): Promise<PdfRead> {
  const st = statSync(path)
  const key = `${path}|${st.size}|${st.mtimeMs}`
  let r = cache.get(key)
  if (!r) {
    r = runHelper(['read', path, '--pages', `1-${MAX_PAGES}`], signal)
    r.catch(() => cache.delete(key))
    cache.set(key, r)
    if (cache.size > 20) cache.delete(cache.keys().next().value!)
  }
  return r
}

const clean = (t: string) => t.replace(/^[•□☐■\s]+|^(?:o|O|0|\[ \]) /, '').replace(/[_:.\s]+$/, '').trim()
const overlapX = (a: { x: number; w: number }, b: { x: number; w: number }) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)

/**
 * What each blank is for, from the words around it: a label on its left, a caption under the line,
 * a column header above it, or the words next to a checkbox. Lines with no words around them are
 * borders or section rules, not blanks.
 */
export function labelBlanks(p: PdfPage): Labeled[] {
  // labels are a few words; sentences around a line are instructions, not what goes on it
  // (page footers like "Page 2 of 4" aren't labels either)
  const words = p.lines.filter((l) => clean(l.t).length > 0 && clean(l.t).length <= 60 && l.y < p.height * 0.93 && !/^page \d+( of \d+)?$/i.test(clean(l.t)))
  p = { ...p, lines: words }
  const blanks = [...p.blanks].sort((a, b) => (Math.abs(a.y - b.y) < 4 ? a.x - b.x : a.y - b.y))
  const lines = blanks.filter((b) => b.kind === 'line')
  // a caption: small text right under a line (Last name, Date, Signature)
  const captionOf = (b: PdfBlank) => p.lines.find((l) => l.y >= b.y - 3 && l.y <= b.y + 16 && l.x >= b.x - 8 && l.x <= b.x + b.w * 0.6 && l.w <= b.w * 0.8)
  const captions = new Set(lines.map(captionOf).filter(Boolean))
  const out: Labeled[] = []
  // a table row's name, shared by every blank on that row
  const rowLabel = new Map<PdfBlank, string>()
  for (const b of blanks) {
    const parts: string[] = []
    if (b.kind === 'box') {
      const cy = b.y + b.h / 2
      const right = p.lines
        .filter((l) => l.y < cy && l.y + l.h > cy && l.x >= b.x - 3 && l.x - (b.x + b.w) < 40)
        .sort((a, z) => a.x - z.x)[0]
      const left = p.lines.filter((l) => l.y < cy && l.y + l.h > cy && l.x + l.w <= b.x + 2 && b.x - (l.x + l.w) < 60).sort((a, z) => z.x - a.x)[0]
      const t = clean((right ?? left)?.t ?? '')
      if (t) parts.push(t)
    } else {
      // on the same row, ending before the blank, with no other blank in between
      const left = p.lines
        .filter((l) => l.y + l.h >= b.y - 18 && l.y + l.h <= b.y + 6 && l.x + l.w <= b.x + 8 && b.x - (l.x + l.w) <= 320 && !captions.has(l))
        .filter((l) => !lines.some((o) => o !== b && Math.abs(o.y - b.y) < 6 && o.x >= l.x + l.w - 4 && o.x + o.w <= b.x + 4))
        .sort((a, z) => z.x + z.w - (a.x + a.w))[0]
      const prev = lines.filter((o) => o !== b && Math.abs(o.y - b.y) < 6 && o.x + o.w <= b.x + 4).sort((x, z) => z.x - x.x)[0]
      const row = left ? clean(left.t) : prev ? rowLabel.get(prev) : undefined
      if (row) { parts.push(row); rowLabel.set(b, row) }
      const caption = captionOf(b)
      if (caption) parts.push(clean(caption.t))
      else {
        // a column header: the nearest words above, with only blanks of the same column in between
        const above = p.lines
          .filter((l) => l.y + l.h <= b.y - 4 && b.y - l.y <= 130 && overlapX(l, b) >= Math.min(l.w, b.w) * 0.5 && !captions.has(l))
          .sort((a, z) => z.y - a.y)[0]
        const between = above && p.lines.some((l) => l !== above && l.y > above.y + above.h - 2 && l.y + l.h < b.y && overlapX(l, b) > 0)
        // blanks stacked in the same column under it count as part of the column
        const stacked = above && lines.some((o) => o !== b && o.y < b.y - 4 && o.y > above.y && overlapX(o, b) >= b.w * 0.7 && Math.abs(o.w - b.w) < b.w * 0.3)
        if (above && !between && (row || stacked || b.y - above.y <= 60)) parts.push(clean(above.t))
      }
    }
    // a page-wide rule is a divider unless something on its left asks for an answer
    // (or a label sits just above its start: "1. Employee's Name" over a writing line)
    const titled = b.kind === 'line' && p.lines.some((l) => l.y + l.h <= b.y && b.y - l.y < 45 && Math.abs(l.x - b.x) < 20)
    if (b.kind === 'line' && b.w > p.width * 0.75 && !rowLabel.has(b) && !titled) continue
    let label = parts.filter(Boolean).join(' / ')
    if (!label && b.kind === 'line') {
      // more lines for the blank above (address line 2, 3)
      const up = out.filter((o) => o.kind === 'line' && Math.abs(o.x - b.x) < 8 && b.y - o.y > 4 && b.y - o.y < 45).sort((x, z) => z.y - x.y)[0]
      if (up) {
        const base = up.label.replace(/ \(line \d+\)$/, '')
        const n = Number(up.label.match(/\(line (\d+)\)$/)?.[1] ?? 1) + 1
        label = `${base} (line ${n})`
      }
    }
    // "(1)" or "_" alone doesn't say what goes there
    if (label && (label.match(/\p{L}/gu)?.length ?? 0) >= 3) out.push({ ...b, id: '', page: p.n, label })
  }
  // ids say what they are ("p5:home-phone"), so an answer put in the wrong blank stands out
  const used = new Map<string, number>()
  return out.map((b) => {
    const base = `p${p.n}:${b.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '') || 'blank'}`
    const n = (used.get(base) ?? 0) + 1
    used.set(base, n)
    return { ...b, id: n === 1 ? base : `${base}-${n}` }
  })
}

/** a page's words in reading order: lines on the same row side by side */
function pageText(p: PdfPage): string {
  const sorted = [...p.lines].sort((a, b) => a.y - b.y || a.x - b.x)
  const rows: PdfLine[][] = []
  for (const l of sorted) {
    const row = rows.at(-1)
    if (row && Math.abs(row[0].y - l.y) < 5) row.push(l)
    else rows.push([l])
  }
  return rows.map((r) => r.sort((a, b) => a.x - b.x).map((l) => l.t).join('    ')).join('\n')
}

const pagesWanted = (spec: string | undefined, count: number): Set<number> | undefined => {
  if (!spec?.trim()) return undefined
  const out = new Set<number>()
  for (const part of spec.split(',')) {
    const [a, b] = part.split('-').map((x) => Number(x.trim()))
    if (Number.isInteger(a)) for (let n = a; n <= (Number.isInteger(b) ? b : a) && n <= count; n++) out.add(n)
  }
  return out.size ? out : undefined
}

const fieldLabel = (f: PdfField, d: PdfRead) => {
  // the words nearest the field on its page tell people what it is
  const page = d.pages.find((p) => p.n === f.page)
  const near = page?.lines.filter((l) => Math.abs(l.y + l.h / 2 - (f.y + f.h / 2)) < 10 && l.x + l.w <= f.x + 4).sort((a, b) => b.x + b.w - (a.x + a.w))[0]
    ?? page?.lines.filter((l) => Math.abs(l.y + l.h / 2 - (f.y + f.h / 2)) < 10 && l.x >= f.x + f.w - 2).sort((a, b) => a.x - b.x)[0]
  return near ? clean(near.t) : f.name
}

export const readPdf: Tool<{ path: string; pages?: string }> = {
  spec: {
    name: 'read_pdf',
    description: 'Read a PDF, including scanned ones (text is recognized on this computer). Returns the text of each page and, for forms, the blanks to fill with their ids, like [p2:date-of-birth] Date of birth. Use fill_pdf with those ids to fill it in. pages: e.g. "1-3,5" (default: all).',
    params: { type: 'object', properties: { path: { type: 'string' }, pages: { type: 'string', description: 'Which pages, e.g. "2" or "1-3,5"' } }, required: ['path'] },
  },
  title: (a) => `Read ${basename(a.path)}`,
  action: (a, ctx) => ({ kind: 'read', paths: [resolvePath(ctx, a.path)] }),
  async run(a, ctx) {
    const path = resolvePath(ctx, a.path)
    if (extname(path).toLowerCase() !== '.pdf') return { text: `${basename(path)} isn't a PDF. Use read_file for other files.`, failed: true }
    if (!existsSync(path)) return { text: `${basename(path)} doesn't exist.`, failed: true }
    ctx.progress?.(`Reading ${basename(path)}…`)
    const d = await analyze(path, ctx.signal)
    const want = pagesWanted(a.pages, d.pageCount)
    const pages = d.pages.filter((p) => !want || want.has(p.n))
    const scanned = d.pages.some((p) => p.ocr)
    const head = `File: ${path}\n${d.pageCount} page${d.pageCount === 1 ? '' : 's'}${scanned ? ', scanned (text was recognized from the page images; check names and numbers)' : ''}${d.pageCount > MAX_PAGES ? `. Only the first ${MAX_PAGES} pages were read.` : ''}`
    const fields = d.fields.filter((f) => !want || want.has(f.page))
    const labeled = new Map(pages.map((p) => [p.n, fields.length ? [] : labelBlanks(p)]))
    const blanks = [...labeled.values()].flat()
    const isForm = fields.length > 0 || blanks.length > 0
    const parts = [head]
    // the form first: it's what the task is about, and it must never be cut off by long pages of text
    if (fields.length) {
      parts.push(`Form fields (fill with fill_pdf using these ids):\n${fields.map((f) => `  [f:${f.name}] ${fieldLabel(f, d)} (${f.type}${f.options?.length && f.type === 'choice' ? `: ${f.options.join(' | ')}` : ''})${f.value && f.value !== 'off' ? ` = "${f.value}"` : ''}`).join('\n')}`)
    } else if (blanks.length) {
      parts.push(`Blanks to fill (fill with fill_pdf using these ids):\n${blanks.map((b) => `  [${b.id}] ${b.label}${b.kind === 'box' ? ' (checkbox)' : ''}`).join('\n')}`)
    }
    if (isForm) parts.push('To fill it in: if the user hasn\'t given any details yet, ask once, in one short list, for answers to these blanks (skip signatures and pages for someone else, like a doctor or HR). Never make up personal details or sign for the user. Once they have given details, call fill_pdf right away with every answer you have; don\'t ask for confirmation and don\'t wait for optional or unclear items. Mention what\'s still empty afterwards; you can fill again later.')
    // the pages' text: in full where the blanks are; a short excerpt of the rest unless asked for
    const formPages = new Set([...blanks.map((b) => b.page), ...fields.map((f) => f.page)])
    let budget = 30_000
    for (const p of pages) {
      let t = pageText(p) || '(no text on this page)'
      // (no "read the rest" hint here: the blanks above are what matter, and the hint made models read every page)
      if (isForm && !want && !formPages.has(p.n) && t.length > 500) t = `${t.slice(0, 500)}… (excerpt)`
      if (t.length > budget) t = `${t.slice(0, Math.max(0, budget))}… (cut; read_pdf with pages="${p.n}" for the rest)`
      budget -= t.length
      parts.push(`--- Page ${p.n} ---\n${t}`)
      if (budget <= 0) { parts.push(`(Stopped here; read_pdf with pages="${p.n + 1}-${d.pageCount}" for the rest.)`); break }
    }
    if (!isForm) parts.push('(No blanks to fill were found.)')
    return { text: parts.join('\n\n') }
  },
}

const TRUE = /^(yes|y|x|true|on|checked|1|✓|✔)$/i

/**
 * "123 Main St, Springfield IL 62701" written on the first line of a blank that has more lines
 * ("Home Address (line 2)") is spread over the empty ones, like a person filling it would.
 */
export function spreadLines(answers: Record<string, string>, blanks: { id: string; label: string }[]): Record<string, string> {
  const out = { ...answers }
  for (const first of blanks) {
    const value = out[first.id]
    if (!value || / \(line \d+\)$/.test(first.label) || !value.includes(',')) continue
    const more = blanks.filter((b) => b.label.startsWith(`${first.label} (line `))
    if (!more.length || more.some((b) => out[b.id]?.trim())) continue
    const parts = value.split(',').map((x) => x.trim()).filter(Boolean)
    const slots = [first, ...more].slice(0, parts.length)
    slots.forEach((b, i) => { out[b.id] = i === slots.length - 1 ? parts.slice(i).join(', ') : parts[i] })
  }
  return out
}

const outName = (ctx: TurnCtx, src: string, wanted?: string) => {
  const stem = wanted ? basename(wanted).replace(/\.pdf$/i, '') : `${basename(src).replace(/\.pdf$/i, '').replace(/ \(filled\)$/, '')} (filled)`
  // filling again (to fix an answer) replaces Hob's earlier filled copy; anything else gets a new name
  const p = join(ctx.chatDir, `${stem}.pdf`)
  if (!existsSync(p) || / \(filled\)\.pdf$/.test(p)) return p
  let q = p
  for (let i = 2; existsSync(q); i++) q = join(ctx.chatDir, `${stem} ${i}.pdf`)
  return q
}

export const fillPdf: Tool<{ path: string; answers: Record<string, unknown>; save_as?: string }> = {
  spec: {
    name: 'fill_pdf',
    description: 'Fill in a PDF form and save a filled copy in the chat folder (the original is kept). answers maps the ids from read_pdf to what to write, e.g. {"p5:name-last-name": "Doe", "p5:i-agree": "yes", "f:email": "a@b.com"}. Match each answer to the id whose name fits it. For checkboxes use "yes". Leave out anything you do not know. To fix a mistake, fill the original again with all the answers.',
    params: {
      type: 'object', required: ['path', 'answers'],
      properties: {
        path: { type: 'string' },
        answers: { type: 'object', additionalProperties: { type: 'string' }, description: 'blank id → text' },
        save_as: { type: 'string', description: 'file name for the filled copy' },
      },
    },
  },
  title: (a) => `Filled in ${basename(a.path)}`,
  action: (a, ctx) => ({ kind: 'create', paths: [outName(ctx, resolvePath(ctx, a.path), a.save_as)] }),
  async run(a, ctx) {
    const path = resolvePath(ctx, a.path)
    if (!existsSync(path)) return { text: `${basename(path)} doesn't exist.`, failed: true }
    const d = await analyze(path, ctx.signal)
    const byId = new Map(d.pages.flatMap((p) => labelBlanks(p)).map((b) => [b.id, b]))
    const fieldNames = new Set(d.fields.map((f) => f.name))
    const marks: { page: number; x: number; y: number; w: number; h: number; text: string; kind: 'text' | 'check' }[] = []
    const fields: Record<string, string> = {}
    const done: string[] = []
    const unknown: string[] = []
    const wrongKind: string[] = []
    const given = spreadLines(Object.fromEntries(Object.entries(a.answers ?? {}).map(([k, v]) => [k, String(v ?? '').trim()])), [...byId.values()])
    for (const [id, raw] of Object.entries(given)) {
      const value = String(raw ?? '').trim()
      if (!value) continue
      if (id.startsWith('f:') && fieldNames.has(id.slice(2))) { fields[id.slice(2)] = value; done.push(`${id} = "${value}"`); continue }
      const b = byId.get(id)
      if (!b) { unknown.push(id); continue }
      if (b.kind === 'box') {
        if (!TRUE.test(value)) continue
        marks.push({ page: b.page, x: b.x, y: b.y, w: b.w, h: b.h, text: 'X', kind: 'check' })
        done.push(`${id} ${b.label}: ticked`)
      } else {
        // "yes" on a line meant for writing is almost always a checkbox answer put in the wrong place
        if (TRUE.test(value) || /^no$/i.test(value)) { wrongKind.push(`${id} (${b.label})`); continue }
        marks.push({ page: b.page, x: b.x, y: b.y, w: b.w, h: b.h, text: value, kind: 'text' })
        done.push(`${id} ${b.label}: "${value}"`)
      }
    }
    // list the real ids, so fixing the call doesn't need another read
    const valid = [...d.fields.map((f) => `f:${f.name} (${fieldLabel(f, d)})`), ...[...byId.values()].map((b) => `${b.id}${b.kind === 'box' ? ' (checkbox)' : ''}`)]
    if (unknown.length) return { text: `Nothing saved: these ids aren't blanks in ${basename(path)}: ${unknown.join(', ')}.\nThe blanks are:\n${valid.map((v) => `  ${v}`).join('\n')}\nCall fill_pdf again with these ids and all the answers.`, failed: true }
    if (wrongKind.length) return { text: `Nothing saved: ${wrongKind.join(', ')} ${wrongKind.length === 1 ? 'is a line' : 'are lines'} to write on, not a checkbox. Write the actual answer there (a date, a name…) or leave it out.`, failed: true }
    if (!done.length) return { text: 'Nothing to fill in: every answer was empty.', failed: true }
    const out = outName(ctx, path, a.save_as)
    const tmp = mkdtempSync(join(tmpdir(), 'hob-pdf-'))
    try {
      const answers = join(tmp, 'answers.json')
      writeFileSync(answers, JSON.stringify({ fields, marks }))
      await runHelper(['fill', path, out, answers], ctx.signal)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
    const filledIds = new Set(Object.keys(given))
    const pagesTouched = new Set(marks.map((m) => m.page))
    const empty = [...byId.values()].filter((b) => pagesTouched.has(b.page) && !filledIds.has(b.id)).map((b) => `${b.id} ${b.label}`)
    return {
      text: `Saved ${basename(out)} (the original is unchanged). Filled ${done.length}:\n${done.map((x) => `  ${x}`).join('\n')}${empty.length ? `\nStill empty on those pages:\n${empty.map((x) => `  ${x}`).join('\n')}` : ''}\nThe answers are added as text boxes, so they can be moved or edited in Preview.`,
      files: [out],
    }
  },
}
