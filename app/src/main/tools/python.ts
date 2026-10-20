import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
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

/** runs a skill's script as if started from the command line, with its folder importable */
export const LAUNCH = (script: string, args: string[] = []) => `import os, runpy, sys
SCRIPT = ${JSON.stringify(script)}
sys.argv = [SCRIPT, *${JSON.stringify(args)}]
sys.path.insert(0, os.path.dirname(SCRIPT))
runpy.run_path(SCRIPT, run_name='__main__')
`

type PyArgs = { code?: string; script?: string; args?: unknown[] }
const scriptOf = (a: PyArgs, ctx: TurnCtx) => {
  const ref = typeof a.script === 'string' ? a.script.trim() : ''
  if (!ref) return undefined
  const s = ctx.skillScript?.(ref)
  return s && s.path.endsWith('.py') && isInside(s.dir, s.path) && existsSync(s.path) ? s : undefined
}

export const runPythonTool: Tool<PyArgs> = {
  spec: {
    name: 'run_python',
    description: 'Run Python 3.12 in the chat folder (the current directory). Installed: pandas, numpy, matplotlib, openpyxl, python-docx, pypdf and Pillow (images and photo EXIF data, such as the date taken). No internet. Use full paths for the user\'s files (Python doesn\'t understand ~). Code can read granted folders but can only save in the chat folder: to rename, move or delete the user\'s files, use move_files, move_file or delete_file. Save outputs into the current folder. For charts use make_chart; matplotlib only for chart types it can\'t draw. Print what you need to see. To run a skill\'s script instead of code, pass script (e.g. "weekly-report/make_report.py") and its inputs as args.',
    params: { type: 'object', properties: {
      code: { type: 'string' },
      script: { type: 'string', description: "a skill's script: skill-name/file.py, or its full path" },
      args: { type: 'array', items: { type: 'string' }, description: 'inputs for the script (sys.argv[1:])' },
    } },
  },
  title: (a) => (typeof a.script === 'string' && a.script.trim() ? `Ran ${basename(a.script.trim())}` : 'Ran code'),
  // a skill whose scripts use the internet is web work: off when Web access is off, and the turn is untrusted after
  action: (a, ctx) => (scriptOf(a, ctx)?.network ? { kind: 'web' } : { kind: 'run' }),
  async run(a, ctx) {
    const wantsScript = typeof a.script === 'string' && a.script.trim() !== ''
    const skill = scriptOf(a, ctx)
    if (wantsScript && !skill) return { text: `“${a.script}” isn't a script in one of your skills. Use the skill-name/file.py form shown in the skill's instructions.`, failed: true }
    if (!skill && typeof a.code !== 'string') return { text: 'Pass code to run, or a skill script.', failed: true }
    const python = await ensurePython(ctx)
    ctx.progress?.(skill ? `Running ${basename(skill.path)}…` : 'Running code…')
    const before = snapshot(ctx.chatDir)
    const args = (Array.isArray(a.args) ? a.args : []).map(String)
    const code = skill ? LAUNCH(skill.path, args) : a.code!
    const r = await runPython({
      python, runtimeRoot: ctx.python!.dir, cwd: ctx.chatDir, tmpDir: ctx.runTmp, code, signal: ctx.signal,
      readPaths: skill ? [skill.dir, ...ctx.grants] : ctx.grants,
      ...(skill?.network ? { network: true } : {}),
      ...(skill ? { env: { HOB_CHAT_DIR: ctx.chatDir, HOB_SKILL_DIR: skill.dir } } : {}),
    })
    if (skill?.network) ctx.untrusted = true
    const files = [...snapshot(ctx.chatDir)].filter(([p, t]) => before.get(p) !== t).map(([p]) => p)
    const status = r.stopped ? 'Stopped by the user.' : r.timedOut ? 'Took longer than 2 minutes and was stopped.' : `Exit code ${r.exitCode}`
    const changed = files.length ? `\nFiles created or changed: ${files.map((f) => f.slice(ctx.chatDir.length + 1)).join(', ')}` : ''
    const shown = skill ? `${skill.path} ${args.join(' ')}`.trim() : a.code!
    return { text: `${status}\n${r.output}${changed}${pythonHint(r.output, skill ? '' : a.code)}`, detail: `${shown}\n\n--- output ---\n${r.output || '(no output)'}`, files, failed: r.exitCode !== 0 }
  },
}
