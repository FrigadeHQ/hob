import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { beforeAll, expect, it } from 'vitest'
import { FakeEngine } from '../src/main/fake'
import { Store } from '../src/main/store'
import { allTools } from '../src/main/tools'
import { AGENT_BUDGET, readAhead, runTurn, type TurnDeps } from '../src/main/agent/turn'
import { TIME_NOTE, systemPrompt } from '../src/main/agent/prompt'
import type { ApprovalAnswer, ApprovalRequest, Attachment, Step } from '../src/shared/agent'
import { ensurePdfHelper } from './pdfHelper'

// the attached-PDF test reads a real PDF with the Mac helper
beforeAll(ensurePdfHelper, 180_000)

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

it('the effort picked beside the mic sets how long it thinks, and how much gpt-oss reasons', async () => {
  const w = world('allow', { grant: false })
  w.deps.effort = () => 'deep'
  await w.turn('a hard question')
  expect(w.engine.lastRequest).toMatchObject({ thoughtBudget: 4096, thoughtBudgetWithTools: 16384, reasoning: 'high' })
  w.deps.effort = () => 'quick'
  await w.turn('a quick one')
  expect(w.engine.lastRequest).toMatchObject({ thoughtBudget: 64, reasoning: 'low' })
  w.deps.effort = () => 'normal'
  await w.turn('a normal one')
  expect(w.engine.lastRequest?.reasoning).toBeUndefined()
})

it('the model hears the time and time zone with each message; the chat keeps what the user wrote', async () => {
  const w = world('allow', { grant: false })
  await w.turn('what time is it?')
  const sent = w.engine.lastRequest?.messages.at(-1)?.content ?? ''
  expect(sent).toMatch(/what time is it\?/)
  expect(sent).toMatch(/\b\d{2}:\d{2}\b/)
  expect(sent).toContain(Intl.DateTimeFormat().resolvedOptions().timeZone)
  expect(w.store.messages('c')[0].content).toBe('what time is it?')
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

it("answers in the app's language unless the user writes in another", () => {
  expect(systemPrompt({ chatDir: '/c', files: [], grants: [], language: 'de' })).toContain("Hob's screens are in German. Reply in the language the user writes in; German when unsure.")
  expect(systemPrompt({ chatDir: '/c', files: [], grants: [], language: 'en' })).not.toContain("Hob's screens are in")
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
  expect(req.messages.at(-1)!.content).toMatch(/^Rome in May\n\n\[The user picked the skill “plan-trip”[\s\S]*Make a day-by-day plan\.\n\[Sent [^\]]*\]$/)
  expect(w.store.messages('c')[0].content).toBe('/plan-trip Rome in May') // the chat shows what the user typed
  // a follow-up still carries the instructions; an unknown /word is left alone
  await w.turn('shorter please')
  expect(w.engine.lastRequest!.messages.at(-3)!.content).toContain('Make a day-by-day plan.')
  await w.turn('/nope hi')
  expect(w.engine.lastRequest!.messages.at(-1)!.content.replace(TIME_NOTE, '')).toBe('/nope hi')
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

it('says it saved a file that does not exist: Hob sends it back once to make the file', async () => {
  const w = withHome()
  await w.turn('__saved__')
  const note = w.engine.lastRequest?.messages.at(-1)?.content ?? ''
  expect(note).toContain('indkob.txt')
  expect(note).toMatch(/doesn't exist/)
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

it('a quick question thinks briefly and gets room to think once it uses a tool, in any language; a path gets it at once', async () => {
  const w = world('allow', { grant: false })
  for (const text of ['hi, how are you?', 'omdøb billederne på mit skrivebord efter dato']) {
    await w.turn(text)
    expect(w.engine.lastRequest).toMatchObject({ thoughtBudget: 256, thoughtBudgetWithTools: AGENT_BUDGET })
  }
  await w.turn('rename the photos in ~/Desktop by date')
  expect(w.engine.lastRequest?.thoughtBudget).toBe(AGENT_BUDGET)
})

it('reading a chat ahead gives exactly what its next message will start with', async () => {
  const w = world('allow', { grant: false })
  let idle = 0
  w.deps.onIdle = () => { idle++ }
  await w.turn('hello there')
  const { vi } = await import('vitest')
  await vi.waitFor(() => expect(idle).toBe(1))
  const chat = w.store.getChat('c')!
  await readAhead(w.deps, { id: 'c', dir: chat.dir, projectId: chat.projectId })
  const readAheadMsgs = w.engine.lastPreload
  await w.turn('and again')
  // the reply's conversation starts with what was read ahead
  expect(w.engine.lastRequest?.messages.slice(0, -1)).toEqual(readAheadMsgs)
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
  expect(sys).toContain(`The main folder is “${w.grant}”`)
  expect(sys).toContain('Project instructions from the user:\nName photos by date')
  // "rename the photos" with no folder named means the project's files: don't ask where they are
  expect(sys).toContain(`“${w.grant}” contains: a.txt`)
  expect(sys).toMatch(/without saying where, they mean the project folders/)
})

it('a project folder that is gone: the prompt says so, and nothing is made there', async () => {
  const w = world('allow', { project: true })
  rmSync(w.grant, { recursive: true })
  const reply = await w.turn(`__tools__ [["write_file",{"path":${JSON.stringify(join(w.grant, 'notes.txt'))},"content":"hi"}]]`)
  expect(w.engine.lastRequest!.messages[0].content).toContain(`The main folder “${w.grant}” can't be found right now`)
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

it('save_skill after web content in the same message is refused without a card', async () => {
  const w = world()
  const { saveSkillTool } = await import('../src/main/plugins/skillTools')
  let saved = 0
  const taint = { spec: { name: 'taint', description: 'd', params: { type: 'object', properties: {} } }, title: () => 'Read a page', action: () => ({ kind: 'run' as const }), run: async (_a: unknown, ctx: { untrusted: boolean }) => { ctx.untrusted = true; return { text: 'page' } } }
  const save = saveSkillTool({ skills: () => [], findSkill: () => undefined, saveSkill: () => { saved++; return { ok: true, name: 'x' } } })
  w.deps.tools = [...w.deps.tools, taint as never, save as never]
  const reply = await w.turn('__tools__ [["taint",{}],["save_skill",{"name":"x","description":"d","instructions":"i"}]]')
  expect(w.asked).toHaveLength(0)
  expect(saved).toBe(0)
  expect(reply.steps.map((s) => [s.tool, s.status])).toEqual([['taint', 'done'], ['save_skill', 'denied']])
})

it('asking to save a skill shows the model the code that worked in the last reply', async () => {
  const w = world('allow', { grant: false })
  w.store.addMessage('c', { role: 'user', content: 'chart my spending' })
  w.store.addMessage('c', { role: 'assistant', content: 'Done.', steps: [
    { id: '1', title: 'Ran code', status: 'done', tool: 'run_python', detail: "import pandas\nprint('ok')\n\n--- output ---\nok" },
    { id: '2', title: 'Ran code', status: 'error', tool: 'run_python', detail: 'broken(\n\n--- output ---\nSyntaxError' },
  ] })
  await w.turn('save that as a skill')
  const sent = w.engine.lastRequest!.messages.map((m) => m.content).join('\n')
  expect(sent).toContain("import pandas\nprint('ok')")
  expect(sent).not.toContain('broken(')
  await w.turn('thanks')
  expect(w.engine.lastRequest!.messages.map((m) => m.content).join('\n')).not.toContain('import pandas')
})

it("skill scripts are found by skill-name/file.py or by full path, only for skills that are on", async () => {
  const w = world()
  const dir = join(w.root, 'skills', 'spending'); mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'make.py'), "open('out.txt','w').write('x')\n")
  const skill = { name: 'spending', description: 'd', body: 'b', dir, network: true }
  w.deps.skills = { list: () => [skill], find: (n) => (n === skill.name ? skill : undefined) }
  let seen: unknown
  const probe = { spec: { name: 'probe', description: 'd', params: { type: 'object', properties: {} } }, title: () => 'Probe', action: () => ({ kind: 'run' as const }),
    run: async (_a: unknown, ctx: import('../src/main/agent/tool').TurnCtx) => { seen = [ctx.skillScript?.('spending/make.py'), ctx.skillScript?.(join(dir, 'make.py')), ctx.skillScript?.('other/make.py')]; return { text: 'ok' } } }
  w.deps.tools = [...w.deps.tools, probe as never]
  await w.turn('__tools__ [["probe",{}]]')
  const hit = { path: join(dir, 'make.py'), dir, network: true }
  expect(seen).toEqual([hit, hit, undefined])
})

it('folder paths in the prompt are quoted, so names with spaces stay whole; the web is never searched for their files', () => {
  const p = systemPrompt({ chatDir: '/c', files: [], grants: ['/Users/eric/My Photos'], home: '/Users/eric',
    project: { name: 'Test', instructions: '', folders: ['/Users/eric/Desktop/untitled folder'], files: ['a.txt'] } })
  expect(p).toContain('“/Users/eric/Desktop/untitled folder”')
  expect(p).toContain('“/Users/eric/My Photos”')
  expect(p).not.toMatch(/untitled folder[^”]/)
  expect(p).toMatch(/never search the web/i)
})

it('a failed or refused step keeps a short reason the user can read', async () => {
  const w = world()
  const reply = await w.turn(`__tools__ [["read_file",{"path":"/etc/hosts"}],["read_file",{"path":"nope.txt"}]]`)
  expect(reply.steps[0]).toMatchObject({ status: 'denied', reason: expect.stringContaining("Hob can't use") })
  expect(reply.steps[1].status).toBe('error')
  expect(reply.steps[1].reason).toBeTruthy()
  expect(reply.steps[1].reason!.length).toBeLessThanOrEqual(160)
})

it('in a project, listing files with no folder named lists the project folder, not the empty chat folder', async () => {
  const w = world('allow', { project: true })
  writeFileSync(join(w.grant, 'budget.xlsx'), 'x')
  const reply = await w.turn('__tools__ [["list_files",{}]]')
  expect(reply.steps[0].title).toBe(`Looked in ${basename(w.grant)}`)
  expect(reply.content).toContain('budget.xlsx')
})

it('Hob knows its own features, so "how do I connect Google Calendar?" gets a real answer', () => {
  const p = systemPrompt({ chatDir: '/c', files: [], grants: [] })
  expect(p).toContain('About Hob')
  expect(p).toMatch(/made by the team behind Frigade/i)
  expect(p).toMatch(/Settings → Connectors → Add connector/)
  expect(p).toMatch(/MCP/)
  expect(p).toMatch(process.platform === 'darwin' ? /Connect my email and calendar/ : /Google Calendar/)
  expect(p).toMatch(/Projects/)
  expect(p).toMatch(/Settings/)
})

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

it('looks at attached photos before answering, so the reply is about what is in them, not the file name', async () => {
  const w = world('allow', { grant: false })
  const photo = join(w.chatDir, '2023-02-15_lion.png'); writeFileSync(photo, PNG)
  w.deps.vision = { state: () => ({ phase: 'ready' }), ask: async () => 'Two men smiling next to a Y Combinator sign.' } as never
  const reply = await w.turn('Roast these guys', [{ name: '2023-02-15_lion.png', path: photo, sizeBytes: PNG.length }])
  expect(reply.steps.map((s) => [s.title, s.status])).toEqual([['Looked at 2023-02-15_lion.png', 'done']])
  expect(w.engine.lastRequest?.messages.at(-1)?.content).toContain('Two men smiling next to a Y Combinator sign.')
  // kept with the message, so follow-ups ("now the one on the left") still know what's in it
  expect(w.store.messages('c')[0].attachments[0].seen).toBe('Two men smiling next to a Y Combinator sign.')
  await w.turn('and the one on the right?')
  expect(w.engine.lastRequest?.messages.at(-3)?.content).toContain('Y Combinator')
})

it.runIf(process.platform === 'darwin')('reads attached PDFs before answering, like photos: a model can not skip opening them', async () => {
  const w = world('allow', { grant: false })
  const pdf = join(w.chatDir, 'homework.pdf'); copyFileSync(join(import.meta.dirname, 'fixtures', 'table-scanned.pdf'), pdf)
  w.deps.vision = { state: () => ({ phase: 'ready' }), ask: async () => '| | X | Y | Z |\n| U | 2,1 | 0,0 | 3,2 |' } as never
  const reply = await w.turn('Solve this', [{ name: 'homework.pdf', path: pdf, sizeBytes: 1 }])
  expect(reply.steps.map((s) => [s.title, s.status])).toEqual([['Read homework.pdf', 'done']])
  expect(w.engine.lastRequest?.messages.at(-1)?.content).toContain('| U | 2,1 | 0,0 | 3,2 |')
  expect(w.store.messages('c')[0].attachments[0].seen).toContain('| U | 2,1')
})

it('reads other attached documents before answering too, and follow-ups still have what was in them without reading again', async () => {
  const w = world('allow', { grant: false })
  const menu = join(w.chatDir, 'wine-menu.txt'); writeFileSync(menu, 'Barolo 2019, Piedmont, $84\nSancerre 2022, Loire, $58\n')
  const reply = await w.turn('What goes with steak?', [{ name: 'wine-menu.txt', path: menu, sizeBytes: 1 }])
  expect(reply.steps.map((s) => [s.title, s.status])).toEqual([['Read wine-menu.txt', 'done']])
  expect(w.engine.lastRequest?.messages.at(-1)?.content).toContain('Barolo 2019')
  expect(w.store.messages('c')[0].attachments[0].seen).toContain('Sancerre 2022')
  const next = await w.turn('and something cheaper?')
  expect(next.steps).toEqual([])
  expect(w.engine.lastRequest?.messages.at(-3)?.content).toContain('Sancerre 2022, Loire, $58')
  // a model that opens it again anyway gets pointed at what it already has
  const again = await w.turn('__tools__ [["read_file",{"path":"wine-menu.txt"}]]')
  expect(again.steps).toEqual([])
  expect(again.content).toContain('already in this conversation')
})

it("doesn't try to look at photos when this computer has no image support", async () => {
  const w = world('allow', { grant: false })
  const photo = join(w.chatDir, 'a.png'); writeFileSync(photo, PNG)
  w.deps.vision = { state: () => ({ phase: 'off' }), ask: async () => '' } as never
  const reply = await w.turn('what is this', [{ name: 'a.png', path: photo, sizeBytes: PNG.length }])
  expect(reply.steps).toEqual([])
})

it('a web address given to read_file is read as a web page, not looked for on disk', async () => {
  const w = world('allow', { grant: false })
  w.deps.webAccess = () => true
  w.deps.fetch = (async () => new Response('<html><body><h1>Top stories</h1><p>' + 'Story one is about databases. '.repeat(20) + '</p></body></html>', { headers: { 'content-type': 'text/html' } })) as never
  const reply = await w.turn('__tools__ [["read_file",{"path":"https://orangebot.ai/hacker-news-top-stories"}]]')
  expect(reply.steps.map((s) => [s.title, s.status])).toEqual([['Read orangebot.ai', 'done']])
})

it('a new chat read ahead in its future folder matches its first message', async () => {
  const w = world('allow', { grant: false })
  const dir = join(w.root, 'next chat')
  await readAhead(w.deps, { dir, projectId: null })
  const readAheadMsgs = w.engine.lastPreload
  mkdirSync(dir); w.store.createChat('n', dir)
  await runTurn(w.deps, { chatId: 'n', requestId: 'r2', text: 'hej', attachments: [], signal: new AbortController().signal })
  expect(w.engine.lastRequest?.messages.slice(0, -1)).toEqual(readAheadMsgs)
})

it('a new chat read ahead with files attached but not yet sent matches its first message', async () => {
  const w = world('allow', { grant: false })
  const dir = join(w.root, 'next chat')
  // attached in the message box: the files reach the chat's folder only when the message is sent
  await readAhead(w.deps, { dir, projectId: null, pending: ['q3-sales.xlsx', 'notes.txt'] })
  const readAheadMsgs = w.engine.lastPreload
  mkdirSync(dir); w.store.createChat('n', dir)
  writeFileSync(join(dir, 'notes.txt'), 'x'); writeFileSync(join(dir, 'q3-sales.xlsx'), 'x')
  await runTurn(w.deps, { chatId: 'n', requestId: 'r2', text: 'draw a graph based on this', attachments: [{ name: 'q3-sales.xlsx', path: join(dir, 'q3-sales.xlsx'), sizeBytes: 1 }], signal: new AbortController().signal })
  expect(w.engine.lastRequest?.messages.slice(0, -1)).toEqual(readAheadMsgs)
})
