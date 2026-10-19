import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { FakeEngine } from '../src/main/fake'
import { Store } from '../src/main/store'
import { allTools } from '../src/main/tools'
import { AGENT_BUDGET, runTurn, type TurnDeps } from '../src/main/agent/turn'
import { systemPrompt } from '../src/main/agent/prompt'
import type { ApprovalAnswer, ApprovalRequest, Attachment, Step } from '../src/shared/agent'

/** grant: the chat was given the Downloads folder. project: instead, the chat is in a project with that folder */
function world(answer: ApprovalAnswer = 'allow', o: { grant?: boolean; project?: boolean; instructions?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'hob-turn-'))
  const chatDir = join(root, 'chat'); const grant = join(root, 'Downloads')
  mkdirSync(chatDir); mkdirSync(grant)
  const store = new Store(':memory:')
  if (o.project) store.createProject('p', { name: 'Japan trip', instructions: o.instructions ?? '', folders: [grant] })
  store.createChat('c', chatDir, undefined, o.project ? 'p' : null)
  if (!o.project && o.grant !== false) store.addChatGrant('c', grant)
  const engine = new FakeEngine()
  const steps: Step[] = []; const asked: ApprovalRequest[] = []
  const deps: TurnDeps = {
    engine, store, tools: allTools(), python: undefined, webAccess: () => false,
    trash: async () => {}, undoDir: join(root, 'undo'), runTmp: join(root, 'tmp'),
    approve: async (req) => { asked.push(req); return answer },
    emit: { token: () => {}, step: (_r, s) => steps.push(s) },
  }
  const turn = (text: string, attachments: Attachment[] = []) => runTurn(deps, { chatId: 'c', requestId: 'r', text, attachments, signal: new AbortController().signal })
  return { root, chatDir, grant, store, engine, steps, asked, turn, deps }
}

it('stores both messages and names the chat after the first message', async () => {
  const w = world('allow', { grant: false }) // plain chat: no files, no folders → small thinking budget
  const reply = await w.turn('hello there')
  expect(reply).toMatchObject({ role: 'assistant', content: 'You said: hello there' })
  expect(w.store.messages('c').map((m) => m.role)).toEqual(['user', 'assistant'])
  // first line at once, then the model's title
  const { vi } = await import('vitest')
  await vi.waitFor(() => expect(w.store.getChat('c')?.title).toBe('Title for: hello there'))
  expect(w.engine.lastRequest?.thoughtBudget).toBe(256)
  expect(w.engine.lastRequest?.tools?.map((t) => t.name)).not.toContain('web_search')
})

it('runs tools, shows steps, and saves files into the chat folder', async () => {
  const w = world()
  writeFileSync(join(w.chatDir, 'sales.csv'), 'a,b\n1,2\n')
  const reply = await w.turn('__tools__ [["read_file",{"path":"sales.csv"}],["write_file",{"path":"summary.txt","content":"total 3"}]]',
    [{ name: 'sales.csv', path: join(w.chatDir, 'sales.csv'), sizeBytes: 8 }])
  expect(readFileSync(join(w.chatDir, 'summary.txt'), 'utf8')).toBe('total 3')
  expect(reply.steps.map((s) => [s.title, s.status])).toEqual([['Read sales.csv', 'done'], ['Wrote summary.txt', 'done']])
  expect(reply.steps[1].files).toEqual([join(w.chatDir, 'summary.txt')])
  expect(w.steps.some((s) => s.status === 'running')).toBe(true)
  expect(w.engine.lastRequest?.thoughtBudget).toBe(AGENT_BUDGET)
  expect(w.engine.lastRequest?.messages.at(-1)?.content).toContain('[Attached: sales.csv]')
  expect(reply.undoable).toBe(false)
})

it('denies paths outside allowed folders and tells the model why', async () => {
  const w = world()
  const reply = await w.turn(`__tools__ [["read_file",{"path":"/etc/hosts"}]]`)
  expect(reply.steps[0].status).toBe('denied')
  expect(reply.content).toContain("Hob can't use /etc/hosts")
  expect(w.asked).toHaveLength(0)
})

it('asks before changing a granted folder; Allow runs it and makes the task undoable', async () => {
  const w = world('allow')
  writeFileSync(join(w.grant, 'a.txt'), 'x')
  const reply = await w.turn(`__tools__ [["delete_file",{"path":${JSON.stringify(join(w.grant, 'a.txt'))}}]]`)
  expect(w.asked[0]).toMatchObject({ text: 'Move a.txt to the Trash?', folder: w.grant })
  expect(reply.steps[0].status).toBe('done')
  expect(reply.undoable).toBe(true)
  expect(w.store.undoOps(reply.taskId!)).toHaveLength(1)
})

it('Deny skips the action; Always stops asking for that folder in this chat', async () => {
  const w = world('deny')
  writeFileSync(join(w.grant, 'a.txt'), 'x')
  const denied = await w.turn(`__tools__ [["delete_file",{"path":${JSON.stringify(join(w.grant, 'a.txt'))}}]]`)
  expect(denied.steps[0].status).toBe('denied')
  expect(existsSync(join(w.grant, 'a.txt'))).toBe(true)

  const w2 = world('always')
  const p = (n: string) => JSON.stringify(join(w2.grant, n))
  await w2.turn(`__tools__ [["write_file",{"path":${p('1.txt')},"content":"1"}],["write_file",{"path":${p('2.txt')},"content":"2"}]]`)
  expect(w2.asked).toHaveLength(1)
})

it('Stop ends the turn and says so', async () => {
  const w = world()
  const ac = new AbortController()
  setTimeout(() => ac.abort(), 400)
  const reply = await runTurn(w.deps, { chatId: 'c', requestId: 'r', text: '__slow__', attachments: [], signal: ac.signal })
  expect(reply.content).toMatch(/\*Stopped\.\*$/)
})

it('a tool that reports failure shows as a failed step, and the model still gets the output', async () => {
  const w = world()
  w.deps.tools = [{
    spec: { name: 'boom', description: '', params: {} }, title: () => 'Ran code', action: () => ({ kind: 'run' }),
    run: async () => ({ text: 'Exit code 1\nKeyError', failed: true }),
  }]
  const reply = await w.turn('__tools__ [["boom",{}]]')
  expect(reply.steps[0].status).toBe('error')
  expect(reply.content).toContain('KeyError')
})

it('the prompt sends granted-folder changes through the file tools', () => {
  const p = systemPrompt({ chatDir: '/c', files: [], grants: ['/Users/me/Downloads'] })
  expect(p).toMatch(/move_file/)
  expect(p).toMatch(/run_python [^.]*can only save in this chat's folder/)
  expect(p).toMatch(/don't ask (the user )?(to confirm|for permission) in (the )?chat/i)
})

it('a tool call that arrives after Stop does nothing', async () => {
  const w = world()
  const ac = new AbortController()
  w.deps.engine = {
    ...w.engine,
    chat: async (_req, h) => { ac.abort(); const r = await h.onTool!('write_file', { path: 'late.txt', content: 'x' }); return r },
  } as typeof w.engine
  await runTurn(w.deps, { chatId: 'c', requestId: 'r', text: 'go', attachments: [], signal: ac.signal })
  expect(existsSync(join(w.chatDir, 'late.txt'))).toBe(false)
})

it('a tool can retitle its step to say what really happened', async () => {
  const w = world()
  w.deps.tools = [{
    spec: { name: 't', description: '', params: {} }, title: () => 'Moved a', action: () => ({ kind: 'run' }),
    run: async () => ({ text: 'already there', title: 'a is already in Docs' }),
  }]
  const reply = await w.turn('__tools__ [["t",{}]]')
  expect(reply.steps[0]).toMatchObject({ title: 'a is already in Docs', status: 'done' })
})

it('repeating a change already made this turn is skipped, not redone or shown again', async () => {
  const w = world('always')
  writeFileSync(join(w.grant, 'a.txt'), 'x')
  const mv = `["move_file",{"from":${JSON.stringify(join(w.grant, 'a.txt'))},"to":${JSON.stringify(join(w.grant, 'D', 'a.txt'))}}]`
  const reply = await w.turn(`__tools__ [${mv},${mv},${mv}]`)
  expect(reply.steps.filter((s) => s.title.startsWith('Moved'))).toHaveLength(1)
  expect(reply.steps).toHaveLength(1)
  expect(reply.content).toMatch(/already done/i)
})

it('records how long the turn took', async () => {
  const w = world()
  const reply = await w.turn('hello')
  expect(reply.workedMs).toBeGreaterThanOrEqual(0)
  expect(w.store.messages('c').at(-1)?.workedMs).toBe(reply.workedMs)
})

it('an identical tool call later in the same turn returns the earlier result without running again', async () => {
  const w = world()
  let runs = 0
  w.deps.tools = [{ spec: { name: 'look', description: '', params: {} }, title: () => 'Looked', action: () => ({ kind: 'run' }), run: async () => { runs++; return { text: 'result A' } } }]
  const reply = await w.turn('__tools__ [["look",{"q":1}],["look",{"q":1}],["look",{"q":2}]]')
  expect(runs).toBe(2)
  expect(reply.steps).toHaveLength(2)
  expect(reply.content).toContain('result A')
})

it("tells the model today's date (so web searches use the right year)", () => {
  const p = systemPrompt({ chatDir: '/c', files: [], grants: [], now: new Date(2026, 9, 15) })
  expect(p).toContain('Today is Thursday, 15 October 2026')
})

it('a reply that starts repeating itself is stopped and trimmed', async () => {
  const w = world()
  const reply = await w.turn('__loop__')
  expect(reply.content.match(/Let me search for these new ones/g)).toHaveLength(1)
  expect(reply.content).toMatch(/repeating myself/i)
})

it('/skill sends the skill instructions with the message, and the prompt lists skills', async () => {
  const w = world()
  const skill = { name: 'plan-trip', description: 'Plan trips day by day', body: 'Make a day-by-day plan.', dir: '/p/skills/plan-trip' }
  w.deps.skills = { list: () => [skill], find: (n) => (n === skill.name ? skill : undefined) }
  w.deps.prompts = () => ['When the user talks about money, use convert_currency.']
  await w.turn('/plan-trip Rome in May')
  const req = w.engine.lastRequest!
  expect(req.messages[0].content).toContain('- plan-trip: Plan trips day by day')
  expect(req.messages[0].content).toContain('use convert_currency')
  expect(req.messages.at(-1)!.content).toMatch(/^Rome in May\n\n\[The user picked the skill “plan-trip”[\s\S]*Make a day-by-day plan\.$/)
  expect(w.store.messages('c')[0].content).toBe('/plan-trip Rome in May') // the chat shows what the user typed
  // a follow-up still carries the instructions; an unknown /word is left alone
  await w.turn('shorter please')
  expect(w.engine.lastRequest!.messages.at(-3)!.content).toContain('Make a day-by-day plan.')
  await w.turn('/nope hi')
  expect(w.engine.lastRequest!.messages.at(-1)!.content).toBe('/nope hi')
})

it('the model names the chat after the first reply; later turns keep the name', async () => {
  const { vi } = await import('vitest')
  const w = world()
  let changed = 0
  w.deps.onChatsChanged = () => { changed++ }
  await w.turn('can u help me plan a bday party for my 8 yr old, maybe dinosaurs?')
  // the first line shows right away, the model's title replaces it
  await vi.waitFor(() => expect(w.store.getChat('c')?.title).toBe('Title for: can u help me'))
  expect(changed).toBeGreaterThanOrEqual(2)
  expect(w.engine.lastTitleRequest).toMatchObject({ tools: [], thoughtBudget: 0, maxTokens: 24 })
  await w.turn('another question')
  await new Promise((r) => setTimeout(r, 50))
  expect(w.store.getChat('c')?.title).toBe('Title for: can u help me')
})

it('cleanTitle tidies what the model wrote', async () => {
  const { cleanTitle } = await import('../src/main/agent/prompt')
  expect(cleanTitle('Title: "Dinosaur birthday party."')).toBe('Dinosaur birthday party')
  expect(cleanTitle('**Weekend in Porto**\nMore text')).toBe('Weekend in Porto')
  expect(cleanTitle('   ')).toBe('')
  expect(cleanTitle('a'.repeat(80)).length).toBeLessThanOrEqual(48)
})

it('titles start with a capital letter', async () => {
  const { cleanTitle } = await import('../src/main/agent/prompt')
  expect(cleanTitle('dinosaur birthday party')).toBe('Dinosaur birthday party')
})

/** a pretend home folder with ~/Desktop/hob-test in it, which Hob has no access to yet */
function withHome(answer: ApprovalAnswer = 'allow') {
  const w = world(answer)
  const home = join(w.root, 'home'); const photos = join(home, 'Desktop', 'hob-test')
  mkdirSync(photos, { recursive: true })
  for (const n of ['IMG_1.jpg', 'IMG_2.jpg']) writeFileSync(join(photos, n), n)
  w.deps.home = home
  return { ...w, home, photos }
}

it("a folder Hob can't use yet: asks for access right in the chat, then carries on", async () => {
  const w = withHome('allow')
  const reply = await w.turn(`__tools__ [["list_files",{"path":${JSON.stringify(w.photos)}}]]`)
  expect(w.asked[0]).toMatchObject({ text: 'Let Hob use your “hob-test” folder?', access: true, detail: join('~', 'Desktop', 'hob-test') })
  expect(reply.steps[0].status).toBe('done')
  expect(reply.content).toContain('IMG_1.jpg')
  expect(reply.content).toContain('The user just gave Hob access')
  expect(w.store.chatGrants('c')).toContain(w.photos)
  // the prompt names the home folder so "my Desktop" becomes a real path
  expect(w.engine.lastRequest?.messages[0].content).toContain(`${w.home}/Desktop`)
})

it('Not now: nothing is read, and the model is told to say so', async () => {
  const w = withHome('deny')
  const reply = await w.turn(`__tools__ [["list_files",{"path":${JSON.stringify(w.photos)}}]]`)
  expect(reply.steps[0].status).toBe('denied')
  expect(reply.content).toContain("didn't give Hob access")
  expect(w.store.chatGrants('c')).not.toContain(w.photos)
})

it('many renames: one approval card that lists them all', async () => {
  const w = withHome('allow')
  w.store.addChatGrant('c', w.photos)
  const moves = [1, 2].map((i) => ({ from: join(w.photos, `IMG_${i}.jpg`), to: join(w.photos, `2024-01-0${i}_001.jpg`) }))
  const reply = await w.turn(`__tools__ [["move_files",${JSON.stringify({ moves })}]]`)
  expect(w.asked).toHaveLength(1)
  expect(w.asked[0]).toMatchObject({ text: 'Rename 2 files in hob-test?', detail: 'IMG_1.jpg → 2024-01-01_001.jpg\nIMG_2.jpg → 2024-01-02_001.jpg' })
  expect(existsSync(join(w.photos, '2024-01-02_001.jpg'))).toBe(true)
  expect(reply.undoable).toBe(true)
})

it('says files were renamed when nothing was: Hob catches it and the model owns up', async () => {
  const w = withHome()
  w.store.addChatGrant('c', w.photos)
  const resets: string[] = []
  w.deps.emit.reset = (r) => resets.push(r)
  const reply = await w.turn('__claim__ rename the photos in ~/Desktop/hob-test by date taken')
  expect(reply.content).toBe("Sorry, I haven't renamed them yet. I only made a list of the new names.")
  expect(resets).toEqual(['r'])
  // the model was told what really happened
  expect(w.engine.lastRequest?.messages.at(-1)?.content).toContain('no file was changed')
  expect(w.engine.lastRequest?.messages.at(-2)).toMatchObject({ role: 'assistant', content: expect.stringContaining('have been renamed') })
})

it('if the model says it again, the reply carries a plain note that nothing changed', async () => {
  const w = withHome()
  w.store.addChatGrant('c', w.photos)
  const reply = await w.turn('__claim__ stubborn: rename the photos in hob-test')
  expect(reply.content).toContain("Hob didn't change any files in this reply.")
})

it('a real rename is not second-guessed', async () => {
  const w = withHome()
  w.store.addChatGrant('c', w.photos)
  const moves = [{ from: join(w.photos, 'IMG_1.jpg'), to: join(w.photos, 'renamed.jpg') }]
  const reply = await w.turn(`__tools__ [["move_files",${JSON.stringify({ moves })}]]`)
  expect(reply.content).toBe('Done. Moved 1 file.')
  expect(w.engine.lastRequest?.messages.at(-1)?.content).not.toContain('Note from Hob')
})

it('the prompt points photo work at Pillow and EXIF, not modified dates', () => {
  const p = systemPrompt({ chatDir: '/c', files: [], grants: ['/Users/eric/Desktop/hob-test'], home: '/Users/eric' })
  expect(p).toContain('Pillow')
  expect(p).toContain('DateTimeOriginal')
  expect(p).toContain('move_files')
  expect(p).toContain('photo_info')
  expect(p).toContain("Don't stop to ask whether to go ahead")
  expect(p).toContain('Only say you did something if a tool result shows it worked')
})

it('stops to ask "shall I go ahead?" on a task about their files: Hob tells it to just do it', async () => {
  const w = withHome()
  w.store.addChatGrant('c', w.photos)
  await w.turn(`__ask__ ${w.photos}`)
  expect(w.engine.lastRequest?.messages.at(-1)?.content).toContain("don't ask whether to go ahead")
  // a plain chat question isn't second-guessed
  const w2 = withHome()
  const r2 = await w2.turn('Want me to go ahead?')
  expect(r2.content).toBe('You said: Want me to go ahead?')
})

it('a request about their files gets room to think, even before any folder is given', async () => {
  const w = world('allow', { grant: false })
  await w.turn('rename the photos on my Desktop by date')
  expect(w.engine.lastRequest?.thoughtBudget).toBe(AGENT_BUDGET)
  await w.turn('hi, how are you?')
  expect(w.engine.lastRequest?.thoughtBudget).toBe(256)
})

it('in a project: new files go in without asking, changes still ask, and the prompt names the project', async () => {
  const w = world('allow', { project: true, instructions: 'Name photos by date' })
  writeFileSync(join(w.grant, 'a.txt'), 'x')
  const p = (n: string) => JSON.stringify(join(w.grant, n))
  const reply = await w.turn(`__tools__ [["write_file",{"path":${p('notes.txt')},"content":"hi"}],["delete_file",{"path":${p('a.txt')}}]]`)
  expect(readFileSync(join(w.grant, 'notes.txt'), 'utf8')).toBe('hi')
  expect(w.asked.map((q) => q.text)).toEqual(['Move a.txt to the Trash?'])
  expect(reply.undoable).toBe(true)
  const sys = w.engine.lastRequest!.messages[0].content
  expect(sys).toContain('project “Japan trip”')
  expect(sys).toContain(`The main folder is ${w.grant}`)
  expect(sys).toContain('Project instructions from the user:\nName photos by date')
  // "rename the photos" with no folder named means the project's files: don't ask where they are
  expect(sys).toContain(`${w.grant} contains: a.txt`)
  expect(sys).toMatch(/without saying where, they mean the project folders/)
})

it('a project folder that is gone: the prompt says so, and nothing is made there', async () => {
  const w = world('allow', { project: true })
  rmSync(w.grant, { recursive: true })
  const reply = await w.turn(`__tools__ [["write_file",{"path":${JSON.stringify(join(w.grant, 'notes.txt'))},"content":"hi"}]]`)
  expect(w.engine.lastRequest!.messages[0].content).toContain(`The main folder ${w.grant} can't be found right now`)
  expect(reply.steps[0].status).not.toBe('done')
  expect(existsSync(w.grant)).toBe(false)
})

it('open_folder with no path opens the project main folder, without asking', async () => {
  const w = world('allow', { project: true })
  const shown: [string, boolean][] = []
  w.deps.reveal = async (p, folder) => { shown.push([p, folder]) }
  const reply = await w.turn('__tools__ [["open_folder",{}]]')
  expect(shown).toEqual([[w.grant, true]])
  expect(w.asked).toHaveLength(0)
  expect(reply.steps[0].status).toBe('done')
})

it('long project instructions are cut; the prompt says how to open folders', () => {
  const p = systemPrompt({ chatDir: '/c', files: [], grants: [], platform: 'win32', project: { name: 'P', instructions: 'x'.repeat(5000), folders: ['/a'] } })
  expect(p).toContain(`${'x'.repeat(4000)}\n(The rest was cut: too long.)`)
  expect(p).not.toContain('x'.repeat(4001))
  expect(p).toMatch(/open_folder[^\n]*File Explorer/)
})

it('stops with nothing to say after doing some work: Hob sends it back once to finish', async () => {
  const w = world()
  const reply = await w.turn('__quit__')
  expect(w.engine.lastRequest?.messages.at(-1)?.content).toContain('you stopped before finishing')
  expect(reply.content).toBe('Finished it.')
  // a plain empty answer with no work done isn't sent back
  const w2 = world('allow', { grant: false })
  expect((await w2.turn('__empty__')).content).toContain("couldn't come up with an answer")
})

it('charts are drawn by Hob (make_chart); Python images only for what it cannot draw', () => {
  const p = systemPrompt({ chatDir: '/c', files: [], grants: [] })
  expect(p).toMatch(/charts?[^\n]*make_chart/i)
  expect(p).toMatch(/matplotlib only for/i)
  expect(allTools().map((t) => t.spec.name)).toContain('make_chart')
})
