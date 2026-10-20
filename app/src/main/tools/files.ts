import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join } from 'node:path'
import { isInside, lexists } from '../workspace'
import { PREVIEW_CHARS, resolvePath, type Tool, type TurnCtx } from '../agent/tool'
import { fileManager } from '../../shared/platform'
import { pythonPreview } from './python'
import { readPdf } from './pdf'

const TEXT = new Set(['.txt', '.md', '.csv', '.tsv', '.json', '.log', '.xml', '.html', '.htm', '.yaml', '.yml', '.py', '.js', '.ts', '.ini', '.cfg'])
const RICH = new Set(['.xlsx', '.xlsm', '.pdf', '.docx'])
const bytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`)
/** granted-folder changes are journaled; the chat folder holds copies, so it isn't */
const inGrant = (ctx: TurnCtx, p: string) => !isInside(ctx.chatDir, p)
/** mkdir -p; new folders in a granted folder are journaled so Undo can remove them */
function makeDir(ctx: TurnCtx, dir: string) {
  const first = mkdirSync(dir, { recursive: true })
  if (first && inGrant(ctx, dir)) ctx.journal.created(first)
}

/** rename, or copy + remove when the two folders are on different drives */
export function moveAcross(from: string, to: string, rename: (a: string, b: string) => void = renameSync) {
  try {
    rename(from, to)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    cpSync(from, to, { recursive: true, errorOnExist: true, force: false })
    rmSync(from, { recursive: true, force: true })
  }
}

type Move = { from: string; to: string }
/** moving new files out of the chat folder (say, code results into a project) only adds files */
/** a plain file, not a program or a folder (an app on a Mac is a folder) */
const plainFile = (p: string) => { try { const st = lstatSync(p); return st.isFile() && (process.platform === 'win32' || (st.mode & 0o111) === 0) } catch { return false } }
const moveKind = (ctx: TurnCtx, moves: Move[]): 'create' | 'change' =>
  moves.length > 0 && moves.every((m) => isInside(ctx.chatDir, m.from) && !isInside(m.from, ctx.chatDir) && plainFile(m.from) && !lexists(m.to)) ? 'create' : 'change'

export const listFiles: Tool<{ path?: string }> = {
  spec: { name: 'list_files', description: "List files in a folder. Defaults to the project's main folder in a project, otherwise the chat folder.", params: { type: 'object', properties: { path: { type: 'string', description: 'Folder path; omit for the project folder (or the chat folder outside projects)' } } } },
  // "what's in here?" in a project means the project's folder, not the (empty) chat folder
  prepare: (a, ctx) => (!a.path?.trim() && ctx.mainFolder && existsSync(ctx.mainFolder) ? { ...a, path: ctx.mainFolder } : a),
  title: (a) => (a.path ? `Looked in ${basename(a.path)}` : 'Looked at your files'),
  action: (a, ctx) => ({ kind: 'read', paths: [resolvePath(ctx, a.path ?? '.')] }),
  async run(a, ctx) {
    const dir = resolvePath(ctx, a.path ?? '.')
    const names = readdirSync(dir).filter((n) => !n.startsWith('.')).sort()
    const lines = names.slice(0, 200).map((n) => {
      const st = statSync(join(dir, n))
      return st.isDirectory() ? `${n}/` : `${n} (${bytes(st.size)})`
    })
    if (names.length > 200) lines.push(`… and ${names.length - 200} more`)
    return { text: `Folder: ${dir}\n${lines.join('\n') || '(empty)'}` }
  },
}

export const readFile: Tool<{ path: string }> = {
  spec: { name: 'read_file', description: 'Preview a file (text, CSV, Excel, PDF, Word). Returns the start of the file and its full path; use run_python to work with all of it.', params: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  title: (a) => `Read ${basename(a.path)}`,
  action: (a, ctx) => ({ kind: 'read', paths: [resolvePath(ctx, a.path)] }),
  async run(a, ctx) {
    const p = resolvePath(ctx, a.path)
    const ext = extname(p).toLowerCase()
    const head = `Path: ${p}\nSize: ${bytes(statSync(p).size)}\n`
    if (TEXT.has(ext)) {
      const all = readFileSync(p, 'utf8')
      const lines = all.split('\n').length
      const cut = all.length > PREVIEW_CHARS ? `\n… (preview; ${all.length} characters in total)` : ''
      return { text: `${head}${lines} lines\n---\n${all.slice(0, PREVIEW_CHARS)}${cut}` }
    }
    if (ext === '.pdf') {
      // Hob's PDF reader also reads scanned pages and lists a form's blanks
      try {
        const r = await readPdf.run({ path: p }, ctx)
        if (!r.failed) return { text: r.text }
      } catch { /* fall back to Python */ }
    }
    if (RICH.has(ext)) return { text: head + '---\n' + (await pythonPreview(p, ctx)) }
    return { text: `${head}This file type can't be previewed as text. Use run_python to work with it.` }
  },
}

export const writeFile: Tool<{ path: string; content: string }> = {
  spec: { name: 'write_file', description: 'Write a text file (creates folders as needed). Paths are relative to the chat folder.', params: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  title: (a) => `Wrote ${basename(a.path)}`,
  action: (a, ctx) => { const p = resolvePath(ctx, a.path); return { kind: existsSync(p) ? 'change' : 'create', paths: [p] } },
  ask: (a) => `Save ${basename(a.path)} in ${basename(dirname(a.path))}?`,
  async run(a, ctx) {
    const p = resolvePath(ctx, a.path)
    // writing follows links; code can plant one, so never write through it
    if (lexists(p) && lstatSync(p).isSymbolicLink()) throw new Error(`${basename(p)} is a link; write to a regular file instead.`)
    const existed = existsSync(p)
    if (inGrant(ctx, p) && existed) ctx.journal.beforeReplace(p)
    makeDir(ctx, dirname(p))
    try {
      // a new file stays new: never overwrite one that appeared since the check
      writeFileSync(p, a.content, existed ? undefined : { flag: 'wx' })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`${basename(p)} already exists now. Read it first, or pick another name.`)
      throw err
    }
    if (inGrant(ctx, p) && !existed) ctx.journal.created(p)
    return { text: `Saved ${p}`, files: [p] }
  },
}

export const moveFile: Tool<{ from: string; to: string }> = {
  spec: { name: 'move_file', description: 'Move or rename a file or folder.', params: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] } },
  title: (a) => `Moved ${basename(a.from)} → ${basename(dirname(a.to))}/${basename(a.to)}`,
  action: (a, ctx) => { const m = { from: resolvePath(ctx, a.from), to: resolvePath(ctx, a.to) }; return { kind: moveKind(ctx, [m]), paths: [m.from, m.to] } },
  ask: (a) => `Move ${basename(a.from)} to ${basename(dirname(a.to))}/${basename(a.to)}?`,
  async run(a, ctx) {
    const from = resolvePath(ctx, a.from); const to = resolvePath(ctx, a.to)
    const folder = basename(dirname(to))
    // models repeat moves they already did; say plainly that it's done so they move on
    if (existsSync(to) && !lexists(from)) return { text: `${basename(to)} is already in ${folder}. Nothing to do; continue with the next file.`, title: `${basename(to)} is already in ${folder}` }
    if (existsSync(to)) return { text: `Not moved: ${to} already exists. Pick another name.`, title: `Couldn't move ${basename(from)}: ${folder} already has one`, failed: true }
    makeDir(ctx, dirname(to))
    moveAcross(from, to)
    if (inGrant(ctx, from) || inGrant(ctx, to)) ctx.journal.moved(from, to)
    return { text: `Moved to ${to}` }
  },
}

const MAX_MOVES = 1000
/** models sometimes send the list as a JSON string; with folder, plain names are inside it */
function movesOf(a: { moves?: unknown; folder?: unknown }): Move[] {
  let m = a.moves
  if (typeof m === 'string') { try { m = JSON.parse(m) } catch { return [] } }
  const list = Array.isArray(m) ? m.filter((x): x is Move => !!x && typeof x.from === 'string' && typeof x.to === 'string') : []
  const folder = typeof a.folder === 'string' && a.folder.trim() ? a.folder.trim() : undefined
  if (!folder) return list
  const inFolder = (p: string) => (isAbsolute(p) || /^(~|\$HOME|\$\{HOME\})(?=$|[\\/])/.test(p) ? p : join(folder, p))
  return list.map((x) => ({ from: inFolder(x.from), to: inFolder(x.to) }))
}
/** the list file, however the model named it: file, path, file_path, filename, or moves: "moves.json" */
function listFile(a: Record<string, unknown>): string | undefined {
  for (const k of ['file', 'path', 'file_path', 'filename']) if (typeof a[k] === 'string' && a[k]) return a[k] as string
  const m = typeof a.moves === 'string' ? a.moves.trim() : ''
  return m && !m.startsWith('[') && !m.startsWith('{') ? m : undefined
}
/** the list code saved: [{from, to}] or {folder, moves}. Only from the chat folder, where code saves */
function movesFromFile(file: string, ctx: TurnCtx): MoveArgs {
  const p = resolvePath(ctx, file)
  const fail = (why: string): MoveArgs => ({ moves: [], fileError: `Couldn't read ${file}: ${why}. Save a JSON list of {"from", "to"} full paths in this chat's folder and pass its name as file.` })
  if (!isInside(ctx.chatDir, p)) return fail("it isn't in this chat's folder")
  let data: unknown
  try { data = JSON.parse(readFileSync(p, 'utf8')) } catch (err) { return fail(lexists(p) ? 'it isn\'t valid JSON' : "it doesn't exist") }
  const o = Array.isArray(data) ? { moves: data } : (data ?? {}) as Record<string, unknown>
  const moves = movesOf(o)
  return moves.length ? { moves, listFile: p } : fail('it has no {"from", "to"} pairs')
}
/** "Rename 20 files in hob-test" or "Move 3 files" */
function describeMoves(moves: Move[]): { verb: 'Rename' | 'Move'; where: string } {
  const dirs = new Set(moves.flatMap((m) => [dirname(m.from), dirname(m.to)]))
  return dirs.size === 1 ? { verb: 'Rename', where: ` in ${basename([...dirs][0])}` } : { verb: 'Move', where: '' }
}
const files = (n: number) => `${n} ${n === 1 ? 'file' : 'files'}`

type MoveArgs = { moves: Move[]; folder?: string; file?: string; fileError?: string; listFile?: string }

export const moveFiles: Tool<MoveArgs> = {
  spec: {
    name: 'move_files',
    description: 'Move or rename many files at once; the user approves them together. Use this instead of many move_file calls. Best for many files: save the list from run_python as a JSON file in the chat folder (a list of {"from", "to"} full paths) and pass its name as file. Or set folder and give plain file names in moves.',
    params: {
      type: 'object',
      properties: { moves: { type: 'array', description: 'Each file and where it goes', items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] } } },
      required: [],
    },
  },
  prepare: (a, ctx) => {
    // small models sometimes call it with nothing right after code saved the list: use that list (the card shows it all)
    const f = listFile(a) ?? (!movesOf(a).length && existsSync(join(ctx.chatDir, 'moves.json')) ? 'moves.json' : undefined)
    return f ? movesFromFile(f, ctx) : a
  },
  title: (a) => { const m = movesOf(a); const d = describeMoves(m); return `${d.verb === 'Rename' ? 'Renamed' : 'Moved'} ${files(m.length)}${d.where}` },
  action: (a, ctx) => { const ms = movesOf(a).map((m) => ({ from: resolvePath(ctx, m.from), to: resolvePath(ctx, m.to) })); return { kind: moveKind(ctx, ms), paths: ms.flatMap((m) => [m.from, m.to]) } },
  ask: (a) => { const m = movesOf(a); const d = describeMoves(m); return `${d.verb} ${files(m.length)}${d.where}?` },
  askDetail: (a) => movesOf(a).map((m) => `${basename(m.from)} → ${basename(m.to)}`).join('\n'),
  async run(a, ctx) {
    if (a.fileError) return { text: a.fileError, failed: true, title: "Couldn't read the list of files" }
    const moves = movesOf(a).map((m) => ({ from: resolvePath(ctx, m.from), to: resolvePath(ctx, m.to) }))
    if (!moves.length) return { text: 'No files given. Pass file: "moves.json" (a JSON list of {"from", "to"} full paths that run_python saved in the chat folder), or moves as a list of {"from", "to"} paths.', failed: true, title: "Couldn't move files: none given", detail: `Hob got: ${JSON.stringify(a).slice(0, 500)}` }
    if (moves.length > MAX_MOVES) return { text: `Too many at once (${moves.length}). Do at most ${MAX_MOVES} per call.`, failed: true, title: `Couldn't move ${files(moves.length)}: too many at once` }
    // check everything first, so a bad name doesn't leave the folder half renamed
    const done = moves.filter((m) => existsSync(m.to) && !lexists(m.from))
    const todo = moves.filter((m) => !done.includes(m))
    const problems: string[] = []
    const targets = new Set<string>()
    for (const m of todo) {
      if (!lexists(m.from)) problems.push(`${m.from} doesn't exist`)
      else if (existsSync(m.to)) problems.push(`${m.to} already exists`)
      else if (targets.has(m.to)) problems.push(`two files would both be called ${basename(m.to)}`)
      targets.add(m.to)
    }
    if (problems.length) {
      return { text: `Nothing was moved. Fix these and call move_files again:\n${problems.slice(0, 30).join('\n')}`, failed: true, title: `Couldn't move ${files(todo.length)}: ${problems.length === 1 ? problems[0].replace(/^.*[\\/]/, '') : `${problems.length} problems`}` }
    }
    const moved: Move[] = []
    try {
      for (const m of todo) {
        if (ctx.signal.aborted) break
        makeDir(ctx, dirname(m.to))
        moveAcross(m.from, m.to)
        if (inGrant(ctx, m.from) || inGrant(ctx, m.to)) ctx.journal.moved(m.from, m.to)
        moved.push(m)
      }
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err)
      return { text: `Moved ${moved.length} of ${todo.length}, then stopped: ${why}`, failed: true, detail: moved.map((m) => `${basename(m.from)} → ${basename(m.to)}`).join('\n') }
    }
    const left = todo.length - moved.length
    const extra = done.length ? ` (${files(done.length)} already done earlier)` : ''
    return {
      text: left ? `Stopped by the user after ${moved.length} of ${todo.length}.` : `Moved ${files(moved.length)}${extra}.`,
      ...(a.listFile ? { uses: [a.listFile] } : {}),
      detail: moved.map((m) => `${basename(m.from)} → ${basename(m.to)}`).join('\n'),
    }
  },
}

export const deleteFile: Tool<{ path: string }> = {
  spec: { name: 'delete_file', description: 'Move a file or folder to the Trash.', params: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  title: (a) => `Moved ${basename(a.path)} to the Trash`,
  action: (a, ctx) => ({ kind: 'change', paths: [resolvePath(ctx, a.path)] }),
  ask: (a) => `Move ${basename(a.path)} to the Trash?`,
  async run(a, ctx) {
    const p = resolvePath(ctx, a.path)
    if ([ctx.chatDir, ...ctx.grants].some((root) => isInside(p, root))) throw new Error("Won't delete the whole folder. Delete the files inside it instead.")
    if (inGrant(ctx, p)) ctx.journal.beforeDelete(p)
    await ctx.trash(p)
    return { text: `Moved ${p} to the Trash` }
  },
}

/** no path: the project's main folder, else the chat folder */
const openTarget = (a: { path?: string }, ctx: TurnCtx) => (a.path ? resolvePath(ctx, a.path) : ctx.mainFolder ?? ctx.chatDir)
const mainMissing = (a: { path?: string }, ctx: TurnCtx) => !a.path && !!ctx.mainFolder && !!ctx.missingFolders?.includes(ctx.mainFolder)
/** an app, plug-in or package: on a Mac these are folders, and opening one runs it */
const isBundle = (p: string) => process.platform === 'darwin' && (/\.[a-z0-9]+$/i.test(basename(p)) || existsSync(join(p, 'Contents', 'Info.plist')))

export const openFolder: Tool<{ path?: string }> = {
  spec: {
    name: 'open_folder',
    description: `Open a folder on the user's screen (in ${fileManager(process.platform)}), or show a file inside its folder. Omit path for the project's main folder, or this chat's folder.`,
    params: { type: 'object', properties: { path: { type: 'string', description: 'Folder or file; omit for the main folder' } } },
  },
  title: (a) => `Opened ${a.path ? basename(a.path) || a.path : 'the folder'}`,
  action: (a, ctx) => ({ kind: 'read', paths: [mainMissing(a, ctx) ? ctx.chatDir : openTarget(a, ctx)] }),
  async run(a, ctx) {
    const p = openTarget(a, ctx)
    if (mainMissing(a, ctx)) return { text: `Can't find ${p}. It may have been moved or renamed, or be on a drive that isn't plugged in. Tell the user.`, failed: true, title: `Couldn't find ${basename(p)}` }
    if (!ctx.reveal) return { text: "Opening folders isn't available here.", failed: true }
    if (!existsSync(p)) return { text: `${p} doesn't exist.`, failed: true, title: `Couldn't find ${basename(p)}` }
    const folder = statSync(p).isDirectory() && !isBundle(p)
    await ctx.reveal(p, folder)
    const app = fileManager(process.platform)
    return folder ? { text: `Opened ${p} in ${app}.` } : { text: `Showed ${basename(p)} in its folder in ${app}.`, title: `Showed ${basename(p)} in its folder` }
  },
}
