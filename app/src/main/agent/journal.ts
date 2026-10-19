import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { lexists, sizeOf, uniqueName } from '../workspace'

/** Deletes bigger than this aren't copied first (that would freeze the app and double disk use); the Trash still has them. */
export const MAX_BACKUP_BYTES = 200e6

export type UndoOp =
  | { type: 'created'; path: string }
  | { type: 'replaced'; path: string; backup: string }
  | { type: 'moved'; from: string; to: string }
  | { type: 'deleted'; path: string; backup: string | null }

/** Records granted-folder changes for one task so Undo can reverse them. */
export class Journal {
  private n = 0
  constructor(private d: { backupDir: string; save(op: UndoOp): void; maxBackupBytes?: number }) {}
  get count() { return this.n }
  private record(op: UndoOp) { this.n++; this.d.save(op) }
  private backup(p: string): string {
    mkdirSync(this.d.backupDir, { recursive: true })
    const dest = join(this.d.backupDir, `${this.n}-${basename(p)}`)
    cpSync(p, dest, { recursive: true })
    return dest
  }
  created(path: string) { this.record({ type: 'created', path }) }
  /** call before overwriting an existing file */
  beforeReplace(path: string) { this.record({ type: 'replaced', path, backup: this.backup(path) }) }
  moved(from: string, to: string) { this.record({ type: 'moved', from, to }) }
  /** call before moving a file to the Trash */
  beforeDelete(path: string) {
    const small = sizeOf(path) <= (this.d.maxBackupBytes ?? MAX_BACKUP_BYTES)
    this.record({ type: 'deleted', path, backup: small ? this.backup(path) : null })
  }
}

/** a free spot for `p`: itself, or "name (2).ext" if something new is there now */
const freePath = (p: string) => (lexists(p) ? join(dirname(p), uniqueName(dirname(p), basename(p))) : p)

/** Reverse a task's changes, newest first. Never overwrites; skips what it can't undo and counts it. */
export async function undo(ops: UndoOp[], trash: (path: string) => Promise<void>): Promise<{ failed: number }> {
  let failed = 0
  for (const op of [...ops].reverse()) {
    try {
      if (op.type === 'created') {
        // a folder the user has since put things in stays
        const keep = !existsSync(op.path) || (statSync(op.path).isDirectory() && readdirSync(op.path).length > 0)
        if (!keep) await trash(op.path)
      } else if (op.type === 'replaced') {
        if (!existsSync(op.backup)) { failed++; continue }
        cpSync(op.backup, op.path, { recursive: true, force: true })
      } else if (op.type === 'moved') {
        if (!lexists(op.to)) { failed++; continue }
        mkdirSync(dirname(op.from), { recursive: true })
        renameSync(op.to, freePath(op.from))
      } else {
        if (!op.backup || !existsSync(op.backup)) { failed++; continue }
        cpSync(op.backup, freePath(op.path), { recursive: true })
      }
    } catch {
      failed++
    }
  }
  return { failed }
}

/** Drop undo backups for deleted chats' tasks and anything older than the cutoff. */
export function pruneUndo(root: string, o: { taskIds?: string[]; olderThanDays?: number }) {
  if (!existsSync(root)) return
  const cutoff = o.olderThanDays === undefined ? -Infinity : Date.now() - o.olderThanDays * 86_400_000
  for (const name of readdirSync(root)) {
    const p = join(root, name)
    if (o.taskIds?.includes(name) || statSync(p).mtimeMs < cutoff) rmSync(p, { recursive: true, force: true })
  }
}
