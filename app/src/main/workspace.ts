import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Attachment } from '../shared/agent'

export const MAX_COPY_BYTES = 1e9

/** true for anything at p, including a symlink whose target is missing */
export const lexists = (p: string) => { try { lstatSync(p); return true } catch { return false } }

/**
 * realpath of p; for paths that don't exist yet, realpath of the nearest existing ancestor + the rest.
 * Dangling symlinks are followed by hand: a link to a not-yet-existing file outside the root must not count as inside.
 */
export function realish(p: string, depth = 0): string {
  if (depth > 40) throw new Error('Too many symlinks')
  let cur = resolve(p)
  const rest: string[] = []
  while (!lexists(cur)) {
    const up = dirname(cur)
    if (up === cur) break
    rest.unshift(basename(cur))
    cur = up
  }
  try {
    // native: the real letter case too, so /users/me/library is seen as ~/Library on Mac and Windows
    return join(realpathSync.native(cur), ...rest)
  } catch (err) {
    if (!lstatSync(cur).isSymbolicLink()) throw err
    return realish(join(resolve(dirname(cur), readlinkSync(cur)), ...rest), depth + 1)
  }
}

export function isInside(root: string, p: string): boolean {
  const r = relative(realish(root), realish(p))
  return r === '' || (r !== '..' && !r.startsWith('..' + sep) && !isAbsolute(r))
}

/** the folder a new chat would get now, not made yet */
export function nextChatDir(filesDir: string, now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const base = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}.${pad(now.getMinutes())}`
  let dir = join(filesDir, base)
  for (let i = 2; existsSync(dir); i++) dir = join(filesDir, `${base} (${i})`)
  return dir
}

export function newChatDir(filesDir: string, now = new Date()): string {
  const dir = nextChatDir(filesDir, now)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function uniqueName(dir: string, name: string): string {
  if (!existsSync(join(dir, name))) return name
  const ext = extname(name)
  const stem = name.slice(0, name.length - ext.length)
  for (let i = 2; ; i++) {
    const n = `${stem} (${i})${ext}`
    if (!existsSync(join(dir, n))) return n
  }
}

export function sizeOf(p: string): number {
  if (!existsSync(p)) return 0
  const st = lstatSync(p)
  if (st.isSymbolicLink()) return 0
  if (!st.isDirectory()) return st.size
  return readdirSync(p).reduce((sum, n) => sum + sizeOf(join(p, n)), 0)
}

export class TooBigError extends Error {
  name = 'TooBigError'
  constructor(public bytes: number) { super(`${bytes} bytes is too big to copy`) }
}

export class AlreadyHereError extends Error {
  name = 'AlreadyHereError'
  constructor(name: string) { super(`${name} is already in this chat`) }
}

/** The files location must be a real, specific folder: not relative, not / or the home folder itself. */
export function validFilesDir(p: string): boolean {
  if (!isAbsolute(p)) return false
  const r = resolve(p)
  return r !== resolve('/') && r !== resolve(homedir()) && dirname(r) !== r
}

/** Copy files/folders into the chat folder. Originals are never touched; symlinks are skipped. */
export function copyIn(chatDir: string, sources: string[], max = MAX_COPY_BYTES): Attachment[] {
  for (const src of sources) {
    if (isInside(chatDir, src) || isInside(src, chatDir)) throw new AlreadyHereError(basename(src))
  }
  const sizes = sources.map(sizeOf)
  const total = sizes.reduce((a, b) => a + b, 0)
  if (total > max) throw new TooBigError(total)
  return sources.map((src, i) => {
    const name = uniqueName(chatDir, basename(src))
    const dest = join(chatDir, name)
    cpSync(src, dest, { recursive: true, filter: (s) => !lstatSync(s).isSymbolicLink() })
    return { name, path: dest, sizeBytes: sizes[i] }
  })
}

const RUNNABLE = /\.(app|command|sh|bash|zsh|tool|terminal|workflow|scpt|applescript|pkg|mpkg|dmg|exe|bat|cmd|com|msi|ps1|vbs|jar|py|rb|pl|webloc|inetloc|fileloc|url|desktop|appimage)$/i
/** Opening these would run something (or follow a link); reveal them in the folder instead. */
export const isRunnable = (p: string) => RUNNABLE.test(p)
