import { DatabaseSync } from 'node:sqlite'
import type { Attachment, ChatSummary, Project, ProjectInput, Step, StoredMessage } from '../shared/agent'

type Row = Record<string, unknown>
type NewMessage = { role: 'user' | 'assistant'; content: string; attachments?: Attachment[]; steps?: Step[]; taskId?: string; undoable?: boolean; workedMs?: number }

const toChat = (r: Row): ChatSummary => ({ id: String(r.id), title: String(r.title), dir: String(r.dir), updatedAt: Number(r.updated_at), projectId: r.project_id == null ? null : String(r.project_id) })
export type ProjectRow = Omit<Project, 'missing'>
const toMessage = (r: Row): StoredMessage & { chatId: string } => ({
  id: Number(r.id), chatId: String(r.chat_id), role: r.role as 'user' | 'assistant', content: String(r.content),
  attachments: JSON.parse(String(r.attachments)), steps: JSON.parse(String(r.steps)),
  ...(r.task_id ? { taskId: String(r.task_id) } : {}), undoable: !!r.undoable, undone: !!r.undone,
  ...(r.worked_ms != null ? { workedMs: Number(r.worked_ms) } : {}),
})

/** about 100 characters of text around the first match, on one line */
function snippet(text: string, q: string): string {
  const flat = text.replace(/\s+/g, ' ')
  const i = Math.max(0, flat.toLowerCase().indexOf(q.toLowerCase()))
  const start = Math.max(0, i - 40)
  const end = Math.min(flat.length, i + q.length + 60)
  return `${start > 0 ? '…' : ''}${flat.slice(start, end).trim()}${end < flat.length ? '…' : ''}`
}

/** Chats, projects, messages, folder grants and undo journals, in one SQLite file. */
export class Store {
  private db: DatabaseSync
  constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, title TEXT NOT NULL, dir TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        role TEXT NOT NULL, content TEXT NOT NULL, attachments TEXT NOT NULL DEFAULT '[]', steps TEXT NOT NULL DEFAULT '[]',
        task_id TEXT, undoable INTEGER NOT NULL DEFAULT 0, undone INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
      DROP TABLE IF EXISTS grants;
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, instructions TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS project_folders (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, path TEXT NOT NULL, position INTEGER NOT NULL, PRIMARY KEY (project_id, path));
      CREATE TABLE IF NOT EXISTS chat_grants (chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE, path TEXT NOT NULL, added_at INTEGER NOT NULL, PRIMARY KEY (chat_id, path));
      CREATE TABLE IF NOT EXISTS always_allow (chat_id TEXT NOT NULL, folder TEXT NOT NULL, PRIMARY KEY (chat_id, folder));
      CREATE TABLE IF NOT EXISTS undo_ops (task_id TEXT NOT NULL, seq INTEGER NOT NULL, op TEXT NOT NULL, PRIMARY KEY (task_id, seq));
      CREATE TABLE IF NOT EXISTS plugin_state (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS plugin_settings (id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (id, key));
      CREATE TABLE IF NOT EXISTS plugin_links (path TEXT PRIMARY KEY, added_at INTEGER NOT NULL);
    `)
    // columns added after the first release
    const cols = (this.db.prepare('PRAGMA table_info(messages)').all() as Row[]).map((r) => String(r.name))
    if (!cols.includes('worked_ms')) this.db.exec('ALTER TABLE messages ADD COLUMN worked_ms INTEGER')
    const chatCols = (this.db.prepare('PRAGMA table_info(chats)').all() as Row[]).map((r) => String(r.name))
    if (!chatCols.includes('project_id')) this.db.exec('ALTER TABLE chats ADD COLUMN project_id TEXT')
  }
  close() { this.db.close() }

  createChat(id: string, dir: string, now = Date.now(), projectId: string | null = null): ChatSummary {
    this.db.prepare('INSERT INTO chats (id, title, dir, created_at, updated_at, project_id) VALUES (?, ?, ?, ?, ?, ?)').run(id, 'New chat', dir, now, now, projectId)
    return this.getChat(id)!
  }
  getChat(id: string): ChatSummary | undefined {
    const r = this.db.prepare('SELECT * FROM chats WHERE id = ?').get(id) as Row | undefined
    return r && toChat(r)
  }
  listChats(): ChatSummary[] {
    return (this.db.prepare('SELECT * FROM chats ORDER BY updated_at DESC, rowid DESC').all() as Row[]).map(toChat)
  }
  /** Chats whose title or messages contain the words, title matches first; message matches carry a snippet. */
  searchChats(query: string, limit = 20): (ChatSummary & { snippet?: string })[] {
    const q = query.trim()
    if (!q) return []
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    const titled = (this.db.prepare("SELECT * FROM chats WHERE title LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT ?").all(like, limit) as Row[]).map(toChat)
    const seen = new Set(titled.map((c) => c.id))
    const said = this.db.prepare(`SELECT c.*, (SELECT content FROM messages m WHERE m.chat_id = c.id AND m.content LIKE ? ESCAPE '\\' ORDER BY m.id DESC LIMIT 1) AS hit
      FROM chats c WHERE hit IS NOT NULL ORDER BY c.updated_at DESC LIMIT ?`).all(like, limit) as Row[]
    const found = said.filter((r) => !seen.has(String(r.id))).map((r) => ({ ...toChat(r), snippet: snippet(String(r.hit), q) }))
    return [...titled, ...found].slice(0, limit)
  }
  renameChat(id: string, title: string) { this.db.prepare('UPDATE chats SET title = ? WHERE id = ?').run(title, id) }
  deleteChat(id: string) { this.db.prepare('DELETE FROM chats WHERE id = ?').run(id) }

  addMessage(chatId: string, m: NewMessage, now = Date.now()): number {
    const r = this.db.prepare('INSERT INTO messages (chat_id, role, content, attachments, steps, task_id, undoable, worked_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(chatId, m.role, m.content, JSON.stringify(m.attachments ?? []), JSON.stringify(m.steps ?? []), m.taskId ?? null, m.undoable ? 1 : 0, m.workedMs ?? null, now)
    // +1 keeps the order stable when two writes land in the same millisecond
    this.db.prepare('UPDATE chats SET updated_at = MAX(updated_at + 1, ?) WHERE id = ?').run(now, chatId)
    return Number(r.lastInsertRowid)
  }
  getMessage(id: number) {
    const r = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as Row | undefined
    return r && toMessage(r)
  }
  updateMessage(id: number, p: { content?: string; steps?: Step[]; undoable?: boolean; undone?: boolean }) {
    const cur = this.getMessage(id)
    if (!cur) return
    this.db.prepare('UPDATE messages SET content = ?, steps = ?, undoable = ?, undone = ? WHERE id = ?')
      .run(p.content ?? cur.content, JSON.stringify(p.steps ?? cur.steps), (p.undoable ?? cur.undoable) ? 1 : 0, (p.undone ?? cur.undone) ? 1 : 0, id)
  }
  messages(chatId: string): StoredMessage[] {
    return (this.db.prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY id').all(chatId) as Row[]).map((r) => {
      const { chatId: _, ...m } = toMessage(r)
      return m
    })
  }

  /** Repoint every stored path under one folder to another (chat folders, attachments, created files). */
  movePaths(fromPrefix: string, toPrefix: string) {
    const json = (p: string) => JSON.stringify(p).slice(1, -1)
    this.db.prepare("UPDATE chats SET dir = ? || substr(dir, ?) WHERE substr(dir, 1, ?) = ?").run(toPrefix, fromPrefix.length + 1, fromPrefix.length, fromPrefix)
    this.db.prepare('UPDATE messages SET attachments = REPLACE(attachments, ?, ?), steps = REPLACE(steps, ?, ?)').run(json(fromPrefix), json(toPrefix), json(fromPrefix), json(toPrefix))
  }

  listProjects(): ProjectRow[] {
    return (this.db.prepare('SELECT * FROM projects ORDER BY created_at, rowid').all() as Row[]).map((r) => this.toProject(r))
  }
  getProject(id: string): ProjectRow | undefined {
    const r = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Row | undefined
    return r && this.toProject(r)
  }
  createProject(id: string, p: ProjectInput, now = Date.now()): ProjectRow {
    this.db.prepare('INSERT INTO projects (id, name, instructions, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, p.name, p.instructions, now, now)
    this.setFolders(id, p.folders)
    return this.getProject(id)!
  }
  updateProject(id: string, p: ProjectInput, now = Date.now()) {
    this.db.prepare('UPDATE projects SET name = ?, instructions = ?, updated_at = ? WHERE id = ?').run(p.name, p.instructions, now, id)
    this.setFolders(id, p.folders)
  }
  /** its chats stay, outside any project */
  removeProject(id: string) {
    this.db.prepare('UPDATE chats SET project_id = NULL WHERE project_id = ?').run(id)
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id)
  }
  private toProject(r: Row): ProjectRow {
    const folders = (this.db.prepare('SELECT path FROM project_folders WHERE project_id = ? ORDER BY position').all(String(r.id)) as Row[]).map((f) => String(f.path))
    return { id: String(r.id), name: String(r.name), instructions: String(r.instructions), folders }
  }
  private setFolders(id: string, folders: string[]) {
    this.db.prepare('DELETE FROM project_folders WHERE project_id = ?').run(id)
    const add = this.db.prepare('INSERT OR IGNORE INTO project_folders (project_id, path, position) VALUES (?, ?, ?)')
    folders.forEach((f, i) => add.run(id, f, i))
  }

  /** folders one chat was allowed to use from the chat itself */
  chatGrants(chatId: string): string[] {
    return (this.db.prepare('SELECT path FROM chat_grants WHERE chat_id = ? ORDER BY added_at, rowid').all(chatId) as Row[]).map((r) => String(r.path))
  }
  addChatGrant(chatId: string, path: string) { this.db.prepare('INSERT OR IGNORE INTO chat_grants (chat_id, path, added_at) VALUES (?, ?, ?)').run(chatId, path, Date.now()) }
  /** every folder of any project or chat: the app may show files from these */
  knownFolders(): string[] {
    return (this.db.prepare('SELECT path FROM project_folders UNION SELECT path FROM chat_grants').all() as Row[]).map((r) => String(r.path))
  }

  alwaysFolders(chatId: string): string[] {
    return (this.db.prepare('SELECT folder FROM always_allow WHERE chat_id = ?').all(chatId) as Row[]).map((r) => String(r.folder))
  }
  addAlways(chatId: string, folder: string) { this.db.prepare('INSERT OR IGNORE INTO always_allow (chat_id, folder) VALUES (?, ?)').run(chatId, folder) }

  addUndoOp(taskId: string, op: unknown) {
    const r = this.db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM undo_ops WHERE task_id = ?').get(taskId) as Row
    this.db.prepare('INSERT INTO undo_ops (task_id, seq, op) VALUES (?, ?, ?)').run(taskId, Number(r.n), JSON.stringify(op))
  }
  undoOps(taskId: string): unknown[] {
    return (this.db.prepare('SELECT op FROM undo_ops WHERE task_id = ? ORDER BY seq').all(taskId) as Row[]).map((r) => JSON.parse(String(r.op)))
  }

  /** undefined: the user never switched it, so the plugin's default applies */
  pluginEnabled(id: string): boolean | undefined {
    const r = this.db.prepare('SELECT enabled FROM plugin_state WHERE id = ?').get(id) as Row | undefined
    return r ? !!r.enabled : undefined
  }
  setPluginEnabled(id: string, on: boolean) { this.db.prepare('INSERT INTO plugin_state (id, enabled) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled').run(id, on ? 1 : 0) }
  /** values as stored (secrets are encrypted by the caller) */
  pluginSettings(id: string): Record<string, string> {
    return Object.fromEntries((this.db.prepare('SELECT key, value FROM plugin_settings WHERE id = ?').all(id) as Row[]).map((r) => [String(r.key), String(r.value)]))
  }
  setPluginSetting(id: string, key: string, value: string | null) {
    if (value === null) this.db.prepare('DELETE FROM plugin_settings WHERE id = ? AND key = ?').run(id, key)
    else this.db.prepare('INSERT INTO plugin_settings (id, key, value) VALUES (?, ?, ?) ON CONFLICT(id, key) DO UPDATE SET value = excluded.value').run(id, key, value)
  }
  forgetPlugin(id: string) {
    this.db.prepare('DELETE FROM plugin_state WHERE id = ?').run(id)
    this.db.prepare('DELETE FROM plugin_settings WHERE id = ?').run(id)
  }
  pluginLinks(): string[] { return (this.db.prepare('SELECT path FROM plugin_links ORDER BY added_at, rowid').all() as Row[]).map((r) => String(r.path)) }
  addPluginLink(path: string) { this.db.prepare('INSERT OR IGNORE INTO plugin_links (path, added_at) VALUES (?, ?)').run(path, Date.now()) }
  removePluginLink(path: string) { this.db.prepare('DELETE FROM plugin_links WHERE path = ?').run(path) }
}
