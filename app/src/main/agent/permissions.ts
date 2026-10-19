import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, parse, relative, resolve, sep } from 'node:path'
import { isInside, realish } from '../workspace'

export type Action =
  | { kind: 'read' | 'create' | 'change'; paths: string[] }
  | { kind: 'run' }
  | { kind: 'web' }
  /** a plugin's app connection; ask = the tool says it deletes or changes things */
  | { kind: 'app'; ask?: boolean }
/** grants: every folder this chat may use (project folders + ones allowed in the chat). project: the project's folders, where new files need no approval */
export type GateCtx = { chatDir: string; grants: string[]; project?: string[]; always: string[]; untrusted: boolean; webAccess: boolean; home?: string; appData?: string }
/** grant: outside every folder, but the user can let Hob use `folder` */
export type Decision = { verdict: 'auto' } | { verdict: 'ask'; folder?: string } | { verdict: 'grant'; folder: string } | { verdict: 'deny'; reason: string }

const SYSTEM = [
  '/System', '/Library', '/Applications', '/usr', '/bin', '/sbin', '/etc', '/private', '/var', '/opt', '/dev', '/tmp',
  '/proc', '/sys', '/boot', '/root', '/run', '/snap', '/lib', '/lib64',
  ...(process.env.SystemRoot ? [process.env.SystemRoot] : []), 'C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\ProgramData',
]
/** the parts of p below root, e.g. ['.git', 'hooks'] */
const partsBelow = (root: string, p: string) => relative(realish(root), realish(p)).split(sep).filter(Boolean)

/**
 * The folder to ask the user about for p: the nearest folder that exists.
 * Never the home folder itself (or anything above it), app settings, or system folders.
 */
export function accessFolder(p: string, home = homedir(), appData?: string): string | undefined {
  let dir = p
  while (!existsSync(dir) || !statSync(dir).isDirectory()) {
    const up = dirname(dir)
    if (up === dir) return undefined
    dir = up
  }
  if (dir === parse(dir).root || isInside(dir, home)) return undefined
  if (isInside(join(home, 'Library'), dir) || isInside(join(home, 'AppData'), dir) || isInside(join(home, '.config'), dir)) return undefined
  if (appData && isInside(appData, dir)) return undefined
  if (!isInside(home, dir) && SYSTEM.some((s) => isInside(s, dir))) return undefined
  // hidden folders (.ssh, .aws…) hold keys and settings
  if (isInside(home, dir) && partsBelow(home, dir).some((part) => part.startsWith('.'))) return undefined
  return dir
}

/** Why a folder the user picked for a project can't be used; undefined if it can. */
export function folderProblem(p: string, home = homedir(), own: string[] = []): string | undefined {
  if (isInside(p, home)) return 'Pick a folder inside your home folder, not the whole thing.'
  // Hob's settings and its chat files: a project there would reach every chat
  if (own.some((o) => isInside(o, p) || isInside(p, o))) return "That's Hob's own folder."
  if (!existsSync(p) || !statSync(p).isDirectory()) return "Can't find this folder."
  if (accessFolder(p, home, own[0]) !== resolve(p)) return "Hob can't use that folder."
  return undefined
}

/** a mistyped path whose folder name matches one Hob can use: the path it probably meant */
function nearMiss(p: string, grants: string[]): string | undefined {
  const parts = resolve(p).split(sep)
  for (const g of grants) {
    const i = parts.lastIndexOf(basename(g))
    if (i > 0) return join(g, ...parts.slice(i + 1))
  }
  return undefined
}

/** Chat folder: automatic. Project folders: reads and new files automatic, changes ask. Other granted folders: reads automatic, changes ask. Anywhere else: ask for access, or denied. */
export function decide(a: Action, c: GateCtx): Decision {
  if (a.kind === 'run') return { verdict: 'auto' }
  if (a.kind === 'app') return a.ask ? { verdict: 'ask' } : { verdict: 'auto' }
  // searching and reading pages is routine; only changes to the user's own files ask
  if (a.kind === 'web') return c.webAccess ? { verdict: 'auto' } : { verdict: 'deny', reason: 'Web access is off. The user can turn it on in Settings.' }
  let folder: string | undefined
  let inProject = true
  for (const p of a.paths) {
    if (isInside(c.chatDir, p)) continue
    const root = (c.project ?? []).find((r) => isInside(r, p))
    // hidden files (.git/hooks, .envrc) can make other programs run code: those ask
    if (!root || partsBelow(root, p).some((part) => part.startsWith('.'))) inProject = false
    const g = c.grants.find((root) => isInside(root, p))
    if (!g) {
      const ask = accessFolder(p, c.home, c.appData)
      if (ask) return { verdict: 'grant', folder: ask }
      const near = nearMiss(p, c.grants)
      if (near) return { verdict: 'deny', reason: `Hob can't use ${p}: there's a typo in the path. Did you mean ${near}? Copy paths exactly, or save the list from code.` }
      return { verdict: 'deny', reason: `Hob can't use ${p}. Tell the user they can add the folder to a project (the + next to Projects in the sidebar), then ask again.` }
    }
    folder = g
  }
  if (!folder || a.kind === 'read') return { verdict: 'auto' }
  // new files in a project folder: that's where the user asked for them; Undo removes them
  // after web content this turn, the request may not be the user's: ask
  if (a.kind === 'create' && inProject && !c.untrusted) return { verdict: 'auto' }
  // web content in this turn could be steering the model: ask again even with "Always"
  if (c.always.includes(folder) && !c.untrusted) return { verdict: 'auto' }
  return { verdict: 'ask', folder }
}
