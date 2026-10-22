import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { accessFolder, decide, folderProblem, type GateCtx } from '../src/main/agent/permissions'

const root = mkdtempSync(join(tmpdir(), 'hob-gate-'))
const chat = join(root, 'chat'); const dl = join(root, 'Downloads'); mkdirSync(chat); mkdirSync(dl)
const ctx = (o: Partial<GateCtx> = {}): GateCtx => ({ chatDir: chat, grants: [dl], always: [], untrusted: false, webAccess: false, ...o })

it('chat folder: everything is automatic', () => {
  for (const kind of ['read', 'create', 'change'] as const) expect(decide({ kind, paths: [join(chat, 'a.csv')] }, ctx()).verdict).toBe('auto')
  expect(decide({ kind: 'run' }, ctx()).verdict).toBe('auto')
})
it('granted folder: reads are automatic, changes ask', () => {
  expect(decide({ kind: 'read', paths: [join(dl, 'x.pdf')] }, ctx()).verdict).toBe('auto')
  expect(decide({ kind: 'change', paths: [join(dl, 'x.pdf')] }, ctx())).toEqual({ verdict: 'ask', folder: dl })
  expect(decide({ kind: 'create', paths: [join(dl, 'new.txt')] }, ctx())).toEqual({ verdict: 'ask', folder: dl })
})
it('"Always in this folder" skips the question, except after web content', () => {
  expect(decide({ kind: 'change', paths: [join(dl, 'x')] }, ctx({ always: [dl] })).verdict).toBe('auto')
  expect(decide({ kind: 'change', paths: [join(dl, 'x')] }, ctx({ always: [dl], untrusted: true })).verdict).toBe('ask')
})
it('outside every folder: denied with a reason', () => {
  expect(decide({ kind: 'read', paths: [join(root, 'secret.txt')] }, ctx()).verdict).toBe('deny')
  expect(decide({ kind: 'read', paths: [join(chat, '..', 'secret.txt')] }, ctx()).verdict).toBe('deny')
})
it('web: automatic when on (the default), denied when switched off', () => {
  expect(decide({ kind: 'web' }, ctx({ webAccess: true })).verdict).toBe('auto')
  expect(decide({ kind: 'web' }, ctx()).verdict).toBe('deny')
})

it("a folder Hob can't use yet: asks the user for access to it instead of refusing", () => {
  const home = join(root, 'home'); const photos = join(home, 'Desktop', 'hob-test')
  mkdirSync(photos, { recursive: true })
  expect(decide({ kind: 'read', paths: [photos] }, ctx({ home }))).toEqual({ verdict: 'grant', folder: photos })
  // a file, or a file that doesn't exist yet: its folder
  expect(decide({ kind: 'change', paths: [join(photos, 'IMG_1.jpg')] }, ctx({ home }))).toEqual({ verdict: 'grant', folder: photos })
  expect(accessFolder(join(photos, 'new', 'x.txt'), home)).toBe(photos)
})
it('never offers the home folder itself, settings, hidden or system folders', () => {
  const home = join(root, 'home2'); mkdirSync(join(home, 'Library', 'Mail'), { recursive: true }); mkdirSync(join(home, '.ssh'), { recursive: true })
  const appData = join(home, 'Library', 'Application Support', 'Hob')
  expect(accessFolder(home, home)).toBeUndefined()
  expect(accessFolder(join(home, 'nope.txt'), home)).toBeUndefined()
  expect(accessFolder(join(home, 'Library', 'Mail'), home)).toBeUndefined()
  expect(accessFolder(join(home, '.ssh', 'id_rsa'), home)).toBeUndefined()
  expect(accessFolder(appData, home, appData)).toBeUndefined()
  expect(accessFolder('/', home)).toBeUndefined()
  expect(accessFolder('/etc/hosts', home)).toBeUndefined()
  expect(decide({ kind: 'read', paths: ['/etc/hosts'] }, ctx({ home })).verdict).toBe('deny')
})

it('project folders: reads and new files are automatic; changing what is there asks', () => {
  const proj = join(root, 'Trip'); mkdirSync(proj, { recursive: true })
  const c = ctx({ grants: [proj, dl], project: [proj] })
  expect(decide({ kind: 'read', paths: [join(proj, 'a.jpg')] }, c).verdict).toBe('auto')
  expect(decide({ kind: 'create', paths: [join(proj, 'summary.docx')] }, c).verdict).toBe('auto')
  expect(decide({ kind: 'change', paths: [join(proj, 'a.jpg')] }, c)).toEqual({ verdict: 'ask', folder: proj })
  // a folder this chat was given (not a project folder): new files still ask
  expect(decide({ kind: 'create', paths: [join(dl, 'new.txt')] }, c)).toEqual({ verdict: 'ask', folder: dl })
  // from the chat folder into the project: still only adds a file
  expect(decide({ kind: 'create', paths: [join(chat, 'out.png'), join(proj, 'out.png')] }, c).verdict).toBe('auto')
})

it('folders the user picks for a project: says why Hob cannot use some', () => {
  const home = join(root, 'h'); const docs = join(home, 'Documents'); const lib = join(home, 'Library', 'Mail'); const ssh = join(home, '.ssh')
  for (const d of [docs, lib, ssh]) mkdirSync(d, { recursive: true })
  expect(folderProblem(docs, home)).toBeUndefined()
  expect(folderProblem(home, home)).toMatch(/inside your home folder/)
  expect(folderProblem(root, home)).toMatch(/inside your home folder/)
  expect(folderProblem(lib, home)).toBe("Hob can't use that folder.")
  expect(folderProblem(ssh, home)).toBe("Hob can't use that folder.")
  expect(folderProblem(join(home, 'gone'), home)).toBe("Can't find this folder.")
  expect(folderProblem(join(docs, "Hob data"), home, [docs])).toBe("That's Hob's own folder.")
})

it('the deny reason tells the user how to add a folder', () => {
  const d = decide({ kind: 'read', paths: ['/etc/hosts'] }, ctx())
  expect(d).toMatchObject({ verdict: 'deny' })
  expect((d as { reason: string }).reason).toContain('add the folder to a project')
})

it('project folders: new hidden files (.git/hooks, .envrc) and anything after web content still ask', () => {
  const proj = join(root, 'Repo'); mkdirSync(join(proj, '.git', 'hooks'), { recursive: true })
  const c = ctx({ grants: [proj], project: [proj] })
  expect(decide({ kind: 'create', paths: [join(proj, '.git', 'hooks', 'pre-commit')] }, c).verdict).toBe('ask')
  expect(decide({ kind: 'create', paths: [join(proj, '.envrc')] }, c).verdict).toBe('ask')
  expect(decide({ kind: 'create', paths: [join(proj, 'notes.txt')] }, { ...c, untrusted: true }).verdict).toBe('ask')
})

it("Hob's own files folder can't be a project folder", () => {
  const home = join(root, 'h2'); const docs = join(home, 'Documents'); const files = join(docs, 'Hob')
  mkdirSync(files, { recursive: true })
  expect(folderProblem(docs, home, [files])).toBe("That's Hob's own folder.")
  expect(folderProblem(files, home, [files])).toBe("That's Hob's own folder.")
})

it.runIf(process.platform === 'darwin')('a path typed in other letter case is still the home folder, Library or a hidden folder', () => {
  const home = join(root, 'Casey'); mkdirSync(join(home, '.ssh'), { recursive: true }); mkdirSync(join(home, 'Library', 'Keychains'), { recursive: true })
  expect(accessFolder(home.toLowerCase(), home)).toBeUndefined()
  expect(accessFolder(join(home.toLowerCase(), '.ssh'), home)).toBeUndefined()
  expect(accessFolder(join(home, 'library', 'Keychains'), home)).toBeUndefined()
})

it.runIf(process.platform === 'linux')('Linux system folders are never offered', () => {
  for (const p of ['/proc/self', '/sys/kernel', '/boot', '/root', '/run/user']) expect(accessFolder(p, '/home/me')).toBeUndefined()
})

it('a mistyped path next to a folder Hob can use: the refusal suggests the right one', () => {
  const typo = join(root, 'Downlaods-x', '..', 'typo', 'Downloads', 'IMG_1.jpg').replace('typo', 'tpyo')
  const d = decide({ kind: 'change', paths: [typo] }, ctx())
  expect(d.verdict).toBe('deny')
  expect((d as { reason: string }).reason).toContain(`Did you mean “${join(dl, 'IMG_1.jpg')}”?`)
})

it('a folder name cut off at a space ("untitled" for "untitled folder") points to the real folder', () => {
  const real = join(root, 'untitled folder')
  mkdirSync(real, { recursive: true })
  const d = decide({ kind: 'read', paths: [join(root, 'untitled')] }, { ...ctx(), grants: [real], project: [real] })
  expect(d.verdict).toBe('deny')
  expect((d as { reason: string }).reason).toContain(`Did you mean “${real}”?`)
})

it("a cut-off project folder name is corrected, not turned into a request for its whole parent folder", () => {
  const parent = join(root, 'Downloads-cut')
  const real = join(parent, 'untitled folder')
  mkdirSync(real, { recursive: true })
  // the parent exists and could be offered; the near miss wins because the path itself doesn't exist
  const d = decide({ kind: 'read', paths: [join(parent, 'untitled')] }, { ...ctx(), grants: [real], project: [real], home: root })
  expect(d.verdict).toBe('deny')
  expect((d as { reason: string }).reason).toContain(`Did you mean “${real}”?`)
  // making something new there still gets the folder offered
  expect(decide({ kind: 'create', paths: [join(parent, 'other')] }, { ...ctx(), grants: [real], home: root })).toEqual({ verdict: 'grant', folder: parent })
})

it("reading something that doesn't exist says so, instead of asking for the folder around it", () => {
  // e.g. a model writing the chat folder's path a little wrong: a prompt for the folder above can't help
  const other = join(root, 'Elsewhere'); mkdirSync(other, { recursive: true })
  const d = decide({ kind: 'read', paths: [join(other, 'nope', 'summary.pdf')] }, ctx({ home: root }))
  expect(d.verdict).toBe('deny')
  expect(d.verdict === 'deny' && d.reason).toMatch(/doesn't exist/)
  // something that exists still asks
  expect(decide({ kind: 'read', paths: [other] }, ctx({ home: root })).verdict).toBe('grant')
})

it("a missing path Hob couldn't use anyway still says how to add a folder, not that it's missing", () => {
  // Windows has no /etc: the refusal is about where it is, as on other systems
  const d = decide({ kind: 'read', paths: ['/etc/hob-no-such-file'] }, ctx())
  expect(d.verdict).toBe('deny')
  expect(d.verdict === 'deny' && d.reason).toContain('add the folder to a project')
})
