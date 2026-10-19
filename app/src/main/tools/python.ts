import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { runPython } from '../python/run'
import { isInside } from '../workspace'
import type { Tool, TurnCtx } from '../agent/tool'

const PREVIEW_PY = `
import sys, os
p = PATH
ext = os.path.splitext(p)[1].lower()
if ext in ('.xlsx', '.xlsm'):
    import openpyxl
    wb = openpyxl.load_workbook(p, read_only=True, data_only=True)
    for ws in wb.worksheets[:5]:
        print(f'## Sheet "{ws.title}" ({ws.max_row} rows x {ws.max_column} columns)')
        for row in ws.iter_rows(max_row=20, values_only=True):
            print(','.join('' if v is None else str(v) for v in row))
elif ext == '.pdf':
    from pypdf import PdfReader
    r = PdfReader(p)
    print(f'{len(r.pages)} pages')
    for i, page in enumerate(r.pages[:5]):
        print(f'--- page {i + 1}')
        print((page.extract_text() or '')[:1500])
elif ext == '.docx':
    import docx
    for para in docx.Document(p).paragraphs[:200]:
        print(para.text)
`

/** Make sure Python is installed, showing progress as a step title. */
export async function ensurePython(ctx: TurnCtx): Promise<string> {
  if (!ctx.python) throw new Error('Code tools are not available.')
  if (!ctx.python.isReady()) ctx.progress?.('Setting up code tools…')
  return ctx.python.ensure((f) => ctx.progress?.(`Setting up code tools… ${Math.round(f * 100)}%`))
}

/** file → mtime, a few levels deep, to spot what code created or changed */
const snapshot = (dir: string) => {
  const m = new Map<string, number>()
  const walk = (d: string, depth: number) => {
    for (const n of readdirSync(d)) {
      if (n.startsWith('.')) continue
      const p = join(d, n)
      const st = statSync(p)
      if (st.isDirectory()) { if (depth < 3) walk(p, depth + 1) } else m.set(p, st.mtimeMs)
    }
  }
  walk(dir, 0)
  return m
}

export async function pythonPreview(path: string, ctx: TurnCtx): Promise<string> {
  const python = await ensurePython(ctx)
  const grant = ctx.grants.find((g) => isInside(g, path))
  const r = await runPython({
    python, runtimeRoot: ctx.python!.dir, cwd: ctx.chatDir, tmpDir: ctx.runTmp, signal: ctx.signal, timeoutMs: 60_000,
    readPaths: grant ? [grant] : [], code: `PATH = ${JSON.stringify(path)}\n${PREVIEW_PY}`,
  })
  return r.exitCode === 0 ? r.output : `Couldn't preview this file:\n${r.output}`
}

/** plain next steps for the errors small models misread ("Operation not permitted" → "the folder doesn't exist") */
export function pythonHint(output: string, code = ''): string {
  const hints: string[] = []
  // getexif() alone holds only the basic tags; the date taken is one level down
  if (/getexif\(\)/.test(code) && /36867|DateTimeOriginal/.test(code) && !/get_ifd|_getexif/.test(code)) {
    hints.push('Note: DateTimeOriginal (36867) is in the Exif IFD, not in getexif() itself: use img.getexif().get_ifd(0x8769).get(36867). Or call photo_info, which reads it for you.')
  }
  if (/PermissionError|Operation not permitted/.test(output)) {
    hints.push("Hob blocked this: code can only read the chat folder and folders the user gave access to, and can only save in the chat folder. To rename, move or delete the user's files, use move_files, move_file or delete_file. If it's a folder Hob can't see yet, call list_files with its full path and Hob will ask the user.")
  }
  if (/(FileNotFoundError|No such file or directory)[^\n]*['"]~/.test(output)) hints.push("Python doesn't understand ~ in paths. Use the full path instead.")
  return hints.length ? `\n\nHob: ${hints.join(' ')}` : ''
}

export const runPythonTool: Tool<{ code: string }> = {
  spec: {
    name: 'run_python',
    description: 'Run Python 3.12 in the chat folder (the current directory). Installed: pandas, numpy, matplotlib, openpyxl, python-docx, pypdf and Pillow (images and photo EXIF data, such as the date taken). No internet. Use full paths for the user\'s files (Python doesn\'t understand ~). Code can read granted folders but can only save in the chat folder: to rename, move or delete the user\'s files, use move_files, move_file or delete_file. Save outputs into the current folder. For charts use make_chart; matplotlib only for chart types it can\'t draw. Print what you need to see.',
    params: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] },
  },
  title: () => 'Ran code',
  action: () => ({ kind: 'run' }),
  async run(a, ctx) {
    const python = await ensurePython(ctx)
    ctx.progress?.('Running code…')
    const before = snapshot(ctx.chatDir)
    const r = await runPython({ python, runtimeRoot: ctx.python!.dir, cwd: ctx.chatDir, tmpDir: ctx.runTmp, code: a.code, signal: ctx.signal, readPaths: ctx.grants })
    const files = [...snapshot(ctx.chatDir)].filter(([p, t]) => before.get(p) !== t).map(([p]) => p)
    const status = r.stopped ? 'Stopped by the user.' : r.timedOut ? 'Took longer than 2 minutes and was stopped.' : `Exit code ${r.exitCode}`
    const changed = files.length ? `\nFiles created or changed: ${files.map((f) => f.slice(ctx.chatDir.length + 1)).join(', ')}` : ''
    return { text: `${status}\n${r.output}${changed}${pythonHint(r.output, a.code)}`, detail: `${a.code}\n\n--- output ---\n${r.output || '(no output)'}`, files, failed: r.exitCode !== 0 }
  },
}
