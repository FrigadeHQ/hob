import { useEffect, useState } from 'react'
import { Folder, FolderPlus, X } from 'lucide-react'
import type { FolderCheck, Project } from '../../../shared/agent'
import { mabel } from '../api'
import { confirmAction } from './Confirm'
import { button, Dialog, Field, field } from './ui'

/** the last part of a path, on any OS */
export const folderName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p

type Props = {
  /** editing this one; absent: a new project */
  project?: Project
  /** a new project starts with these (say, something too big to copy) */
  folders?: string[]
  onClose(): void
  /** saved: its id; removed: null */
  onDone(id: string | null): void
}

/** Create or edit a project: a name, the folders Mabel may use (the first gets new files), and instructions. */
export function ProjectDialog({ project, folders: start, onClose, onDone }: Props) {
  const [name, setName] = useState(project?.name ?? '')
  const [instructions, setInstructions] = useState(project?.instructions ?? '')
  const [folders, setFolders] = useState<string[]>(project?.folders ?? [])
  const [problem, setProblem] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const missing = new Set(project?.missing ?? [])

  function add(checks: FolderCheck[]) {
    const bad = checks.find((c) => c.problem)
    setProblem(bad?.problem ?? null)
    const ok = checks.filter((c) => !c.problem).map((c) => c.path)
    if (!ok.length) return
    setFolders((cur) => [...cur, ...ok.filter((p) => !cur.includes(p))])
    setName((n) => n || folderName(ok[0]))
  }
  useEffect(() => { if (start?.length) void mabel.projects.checkFolders(start).then(add) }, [])

  async function save() {
    // Enter pressed twice must not make two projects
    if (!name.trim() || saving) return
    setSaving(true)
    const input = { name, instructions, folders }
    try {
      const r = project ? await mabel.projects.update(project.id, input) : await mabel.projects.create(input)
      if ('error' in r) { setError(r.error); return }
      onDone(r.id)
    } finally {
      setSaving(false)
    }
  }
  async function remove() {
    if (!project || !await confirmAction({ title: `Remove “${project.name}”?`, body: 'Its chats move to your chat list. Your folders and files stay as they are.', ok: 'Remove project', danger: true })) return
    await mabel.projects.remove(project.id)
    onDone(null)
  }

  return (
    <Dialog title={project ? 'Edit project' : 'Create project'} onClose={onClose} testId="project-dialog">
      <div className="space-y-4">
        <Field label="Name">
          <input data-testid="project-name" autoFocus className={field} value={name} placeholder="Project name"
            onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void save() }} />
        </Field>
        <div>
          <p className="mb-1.5 text-ui font-medium">Folders</p>
          <div className="divide-y divide-line overflow-hidden rounded-control border border-line">
            {folders.map((f, i) => (
              <div key={f} data-testid="project-folder" title={f} className="flex items-center gap-2 px-3 py-2 text-ui">
                <Folder size={16} strokeWidth={1.75} className="shrink-0 text-ink-soft" />
                <span className="min-w-0 flex-1 truncate">{folderName(f)}</span>
                {missing.has(f)
                  ? <span className="shrink-0 text-meta text-muted">Can't find this folder</span>
                  : i === 0 && folders.length > 1 && <span className="shrink-0 text-meta text-muted">New files go here</span>}
                <button aria-label={`Remove ${folderName(f)}`} title="Remove" onClick={() => setFolders((cur) => cur.filter((x) => x !== f))} className="text-muted hover:text-ink"><X size={14} /></button>
              </div>
            ))}
            <button data-testid="project-add-folder" onClick={() => void mabel.projects.pickFolders().then(add)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-ui text-ink-soft transition-colors hover:bg-line/40 hover:text-ink">
              <FolderPlus size={16} strokeWidth={1.75} />Add folder
            </button>
          </div>
          {problem
            ? <p data-testid="project-folder-problem" className="mt-1.5 text-ui text-ink-soft">{problem}</p>
            : !folders.length && <p className="mt-1.5 text-meta text-muted">Optional. Add folders Mabel should work with, like a work folder or your photos. It can see the files in them and asks before changing any.</p>}
        </div>
        <Field label="Instructions (optional)">
          <textarea data-testid="project-instructions" rows={3} className={`${field} resize-none`} value={instructions}
            onChange={(e) => setInstructions(e.target.value)} placeholder="Anything Mabel should know for every chat in this project" />
        </Field>
        {error && <p className="text-ui text-danger">{error}</p>}
        <div className="flex items-center gap-2">
          {project && <button data-testid="project-remove" onClick={() => void remove()} className={button.danger}>Remove project</button>}
          <span className="flex-1" />
          <button onClick={onClose} className={button.quiet}>Cancel</button>
          <button data-testid="project-save" disabled={!name.trim() || saving} onClick={() => void save()} className={button.primary}>{project ? 'Save' : 'Create project'}</button>
        </div>
      </div>
    </Dialog>
  )
}
