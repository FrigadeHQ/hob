import { existsSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import type { FolderCheck, Project, ProjectInput } from '../shared/agent'
import { folderProblem } from './agent/permissions'
import type { ProjectRow } from './store'

export const MAX_NAME = 80

/** Folders the user picked: a file stands for its folder; each says why Garth can't use it, if it can't. */
/** own: Garth's own folders (settings, chat files), never a project folder */
export function checkFolders(paths: string[], home?: string, own: string[] = []): FolderCheck[] {
  const seen = new Set<string>()
  const out: FolderCheck[] = []
  for (const raw of paths) {
    const p = existsSync(raw) && !statSync(raw).isDirectory() ? dirname(raw) : raw
    if (seen.has(p)) continue
    seen.add(p)
    const problem = folderProblem(p, home, own)
    out.push(problem ? { path: p, problem } : { path: p })
  }
  return out
}

/** What the project dialog sent, cleaned. keep: folders already in the project (they may only be missing right now). */
export function cleanProject(input: unknown, home?: string, own: string[] = [], keep: string[] = []): ProjectInput | { error: string } {
  const o = (input ?? {}) as Record<string, unknown>
  const name = String(o.name ?? '').trim().slice(0, MAX_NAME)
  if (!name) return { error: 'Give the project a name.' }
  const folders = checkFolders(Array.isArray(o.folders) ? o.folders.map(String) : [], home, own)
    .filter((f) => !f.problem || keep.includes(f.path))
    .map((f) => f.path)
  return { name, instructions: String(o.instructions ?? ''), folders }
}

export const withMissing = (p: ProjectRow): Project => ({ ...p, missing: p.folders.filter((f) => !existsSync(f)) })
