import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { ToolSpec } from '../../shared/agent'
import type { PythonRuntime } from '../python/runtime'
import type { Action } from './permissions'
import type { Journal } from './journal'

export type TurnCtx = {
  chatDir: string
  grants: string[]
  signal: AbortSignal
  /** set once web content enters the turn; changes ask again */
  untrusted: boolean
  webAccess: boolean
  journal: Journal
  trash(path: string): Promise<void>
  python: PythonRuntime | undefined
  /** scratch dir for code runs */
  runTmp: string
  fetch: typeof fetch
  /** local metasearch; absent when code tools aren't installed */
  search?(query: string, signal: AbortSignal): Promise<{ title: string; url: string; snippet: string }[]>
  /** load a page in a hidden browser and return its HTML after scripts ran (for pages built with JavaScript) */
  render?(url: string, signal: AbortSignal): Promise<string>
  /** sites that couldn't be read this turn; skipped after the first failure */
  unreadableHosts?: Set<string>
  /** the project's main folder (new files go there); absent outside projects */
  mainFolder?: string
  /** project folders that can't be found right now (deleted, renamed, drive unplugged) */
  missingFolders?: string[]
  /** show a folder in the file manager (folder: true) or a file inside its folder; never opens the file itself */
  reveal?(path: string, folder: boolean): Promise<void>
  /** a script of an enabled skill, by full path or "skill-name/file.py"; undefined if it isn't one */
  skillScript?(ref: string): { path: string; dir: string; network: boolean } | undefined
  /** progress for slow setup steps, e.g. installing code tools */
  progress?(title: string): void
}
/**
 * failed: the tool ran but its work didn't succeed (e.g. code exited with an error)
 * title: replaces the step title when what happened differs from what was asked
 */
export type ToolOutput = { text: string; detail?: string; files?: string[]; failed?: boolean; title?: string
  /** files only read to make the result (a chart's data, a list of moves): not shown as cards */
  uses?: string[] }

/** Every agent tool implements this; plugins will too. */
export interface Tool<A = Record<string, unknown>> {
  spec: ToolSpec
  /** turns the model's arguments into the ones the tool works with (e.g. a list read from a file); runs before everything else */
  prepare?(args: A, ctx: TurnCtx): A
  /** plain-English step title, e.g. "Read sales.csv" */
  title(args: A): string
  /** why it can't run right now, checked before anything is asked or shown as waiting */
  refuse?(args: A, ctx: TurnCtx): string | undefined
  /** what it touches, for the permission gate */
  action(args: A, ctx: TurnCtx): Action
  /** the approval question, when the gate asks */
  ask?(args: A): string
  /** shown under the question, e.g. each rename */
  askDetail?(args: A): string
  /** only offered while web access is on */
  needsWeb?: boolean
  run(args: A, ctx: TurnCtx): Promise<ToolOutput>
}

/** Model paths are relative to the chat folder unless absolute; "~/Desktop" and "$HOME/Desktop" mean the user's home. */
export function resolvePath(ctx: Pick<TurnCtx, 'chatDir'>, p: string, home = homedir()): string {
  const m = /^(~|\$HOME|\$\{HOME\})(?=$|[\\/])/.exec(p)
  if (m) return join(home, p.slice(m[0].length))
  return isAbsolute(p) ? p : join(ctx.chatDir, p)
}

export const PREVIEW_CHARS = 6000
