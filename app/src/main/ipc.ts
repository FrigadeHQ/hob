import { app, clipboard, dialog, ipcMain, net, shell, systemPreferences, type BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { ApprovalAnswer, Attachment, UserSettings } from '../shared/agent'
import type { SetupController } from './setup'
import type { Store } from './store'
import type { PythonRuntime } from './python/runtime'
import type { Paths } from './paths'
import { micAccess, type SpeechModel } from './speech'
import { renderPage } from './render'
import { runTurn } from './agent/turn'
import { Approvals } from './agent/approvals'
import { RunningTurns } from './agent/running'
import { pruneUndo, undo, type UndoOp } from './agent/journal'
import { coreTools } from './tools'
import { PLUGIN_FILES, type PluginRegistry } from './plugins/registry'
import { saveSkillTool, useSkillTool } from './plugins/skillTools'
import type { NewSkill } from '../shared/plugins'
import { AlreadyHereError, copyIn, isInside, isRunnable, newChatDir, sizeOf, TooBigError, validFilesDir } from './workspace'
import { loadSettings, updateSettings, webAccessOn } from './settings'
import { checkFolders, cleanProject, withMissing } from './projects'
import type { SearchResult } from './search/searxng'

export type IpcDeps = {
  win(): BrowserWindow | undefined
  setup: SetupController
  store: Store
  python: PythonRuntime | undefined
  paths: Paths
  filesDir(): string
  /** may the renderer open/show/display this path? */
  allowed(p: string): boolean
  search?(query: string, signal: AbortSignal): Promise<SearchResult[]>
  /** absent in fake mode: dictation returns a fixed sentence */
  speech?: SpeechModel
  plugins: PluginRegistry
  fake?: boolean
}

export function registerIpc(d: IpcDeps): { openPluginFile(path: string): Promise<void> } {
  const running = new RunningTurns()
  const send = (channel: string, ...args: unknown[]) => d.win()?.webContents.send(channel, ...args)
  const approvals = new Approvals((req) => send('chat:approval', req))
  const trash = (p: string) => shell.trashItem(p)
  const userSettings = (): UserSettings => ({ webAccess: webAccessOn(loadSettings(d.paths.settings)), filesDir: d.filesDir() })
  d.setup.onState((s) => send('setup:state', s))

  ipcMain.handle('copy', (_e, text: string) => clipboard.writeText(String(text)))
  ipcMain.handle('setup:getState', () => d.setup.state)
  ipcMain.handle('setup:confirm', (_e, modelId?: string) => { void d.setup.confirm(modelId) })
  ipcMain.handle('setup:retry', () => { void d.setup.retry() })

  ipcMain.handle('chats:list', () => d.store.listChats())
  ipcMain.handle('chats:search', (_e, q: string) => d.store.searchChats(String(q)))
  ipcMain.handle('chats:get', (_e, id: string) => {
    const chat = d.store.getChat(id)
    return chat ? { chat, messages: d.store.messages(id) } : null
  })
  ipcMain.handle('chats:create', (_e, projectId?: string | null) => {
    const project = projectId ? d.store.getProject(String(projectId)) : undefined
    return d.store.createChat(randomUUID(), newChatDir(d.filesDir()), Date.now(), project?.id ?? null)
  })
  const removeChat = async (id: string, keepFiles = false) => {
    const chat = d.store.getChat(id)
    if (!chat) return
    if (!keepFiles && existsSync(chat.dir)) await trash(chat.dir).catch(() => {})
    pruneUndo(d.paths.undo, { taskIds: d.store.messages(id).flatMap((m) => (m.taskId ? [m.taskId] : [])) })
    d.store.deleteChat(id)
  }
  ipcMain.handle('chats:remove', (_e, id: string) => removeChat(id))
  /** every chat, gone from Hob; the files they made stay where they are (the page asks first) */
  ipcMain.handle('chats:removeAll', async () => {
    running.stopAll()
    for (const c of d.store.listChats()) await removeChat(c.id, true)
    send('chats:changed')
  })

  ipcMain.handle('files:add', (_e, chatId: string, paths: string[]) => {
    const chat = d.store.getChat(chatId)
    if (!chat) return []
    try {
      return copyIn(chat.dir, paths.filter(Boolean))
    } catch (err) {
      if (err instanceof TooBigError) return { error: 'too-big', gb: err.bytes / 1e9 }
      if (err instanceof AlreadyHereError) return { error: 'already-here', message: err.message }
      throw err
    }
  })
  ipcMain.handle('files:pick', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] })
    return r.canceled ? [] : r.filePaths
  })
  ipcMain.handle('files:open', (_e, p: string) => {
    if (!d.allowed(p)) return
    // the model can write scripts; "Open" must never run one
    if (isRunnable(p)) shell.showItemInFolder(p)
    else void shell.openPath(p)
  })
  ipcMain.handle('files:show', (_e, p: string) => { if (d.allowed(p)) shell.showItemInFolder(p) })
  /** a chart as PNG: the person picks where (Downloads by default); returns where it went, or null */
  ipcMain.handle('files:saveImage', async (_e, dataUrl: string, name: string) => {
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl))
    if (!m) return null
    const safe = `${String(name ?? 'Chart').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'Chart'}.png`
    const win = d.win()
    const opts = { defaultPath: join(app.getPath('downloads'), safe), filters: [{ name: 'PNG image', extensions: ['png'] }] }
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return null
    writeFileSync(r.filePath, Buffer.from(m[1], 'base64'))
    return r.filePath
  })

  const own = () => [d.paths.root, d.filesDir()]
  const check = (paths: string[]) => checkFolders(paths, homedir(), own())
  ipcMain.handle('projects:list', () => d.store.listProjects().map(withMissing))
  ipcMain.handle('projects:create', (_e, input: unknown) => {
    const p = cleanProject(input, homedir(), own())
    if ('error' in p) return p
    const made = d.store.createProject(randomUUID(), p)
    send('chats:changed')
    return withMissing(made)
  })
  ipcMain.handle('projects:update', (_e, id: string, input: unknown) => {
    const cur = d.store.getProject(String(id))
    if (!cur) return { error: 'This project was removed.' }
    const p = cleanProject(input, homedir(), own(), cur.folders)
    if ('error' in p) return p
    d.store.updateProject(cur.id, p)
    send('chats:changed')
    return withMissing(d.store.getProject(cur.id)!)
  })
  ipcMain.handle('projects:remove', (_e, id: string) => { d.store.removeProject(String(id)); send('chats:changed') })
  ipcMain.handle('projects:pickFolders', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'multiSelections', 'createDirectory'] })
    return r.canceled ? [] : check(r.filePaths)
  })
  ipcMain.handle('projects:checkFolders', (_e, paths: string[]) => check((paths ?? []).map(String)))
  /** the main folder, in the file manager */
  ipcMain.handle('projects:open', async (_e, id: string) => {
    const main = d.store.getProject(String(id))?.folders[0]
    if (main && existsSync(main)) await shell.openPath(main)
  })
  /** for open_folder: a folder opens; a file is only shown, so nothing runs */
  const reveal = async (p: string, folder: boolean) => {
    if (!folder) { shell.showItemInFolder(p); return }
    const err = await shell.openPath(p)
    if (err) throw new Error(err)
  }

  const pluginsChanged = () => send('plugins:changed')
  const skillSource = { skills: () => d.plugins.skills(), findSkill: (n: string) => d.plugins.findSkill(n), saveSkill: (s: NewSkill, o?: { replace?: boolean }) => d.plugins.saveSkill(s, o), onSaved: pluginsChanged }

  ipcMain.handle('chat:send', async (_e, chatId: string, requestId: string, text: string, attachments: Attachment[]) => {
    const chat = d.store.getChat(chatId)
    const ac = running.start(requestId)
    try {
      const skills = d.plugins.skills()
      // app connections still starting get a few seconds; they're ready for the next message
      const tools = [...coreTools(), ...(await d.plugins.tools({ waitMs: 8000, signal: ac.signal })), ...(skills.length ? [useSkillTool(skillSource)] : []), saveSkillTool(skillSource)]
      return await runTurn({
        engine: d.setup.engine, store: d.store, tools, python: d.python,
        skills: { list: () => d.plugins.skills(), find: (n) => d.plugins.findSkill(n) },
        prompts: (offered) => d.plugins.prompts(offered),
        webAccess: () => webAccessOn(loadSettings(d.paths.settings)),
        search: d.search,
        // Chromium's network stack: pages see a normal browser, not a script
        fetch: d.fake ? undefined : (net.fetch as unknown as typeof fetch),
        render: d.fake ? undefined : renderPage,
        trash, undoDir: d.paths.undo, runTmp: d.paths.runTmp, appData: d.paths.root,
        approve: (req, signal) => approvals.wait(req, signal), reveal,
        onChatsChanged: () => send('chats:changed'),
        emit: { token: (r, t, thought) => send('chat:token', r, t, thought), step: (r, s) => send('chat:step', r, s), reset: (r) => send('chat:reset', r) },
      }, {
        chatId, requestId, text, signal: ac.signal,
        // only files that really are in this chat's folder
        attachments: (attachments ?? []).filter((a) => chat && isInside(chat.dir, a.path)),
      })
    } finally {
      running.finish(requestId)
    }
  })
  ipcMain.handle('chat:stop', (_e, requestId: string) => running.stop(requestId))
  ipcMain.handle('approval:answer', (_e, id: string, answer: ApprovalAnswer) => approvals.answer(String(id), answer))

  ipcMain.handle('task:undo', async (_e, messageId: number) => {
    const m = d.store.getMessage(messageId)
    if (!m?.taskId || !m.undoable || m.undone) return { done: false, failed: 0 }
    const { failed } = await undo(d.store.undoOps(m.taskId) as UndoOp[], trash)
    // marked undone even if partial: replaying would only redo the parts that worked
    d.store.updateMessage(messageId, { undone: true })
    return { done: true, failed }
  })

  ipcMain.handle('settings:get', userSettings)
  ipcMain.handle('settings:set', (_e, patch: Partial<UserSettings>) => {
    updateSettings(d.paths.settings, {
      ...(patch.webAccess !== undefined ? { webAccess: !!patch.webAccess } : {}),
      ...(patch.filesDir && validFilesDir(String(patch.filesDir)) ? { filesDir: String(patch.filesDir) } : {}),
    })
    // Web access is also the Web search plugin's switch
    if (patch.webAccess !== undefined) send('plugins:changed')
    return userSettings()
  })
  ipcMain.handle('settings:pickFilesDir', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })
  ipcMain.handle('speech:mic', () => (process.platform === 'darwin' && !d.fake
    ? micAccess(systemPreferences.getMediaAccessStatus('microphone'), () => systemPreferences.askForMediaAccess('microphone'))
    : true))
  ipcMain.handle('speech:micSettings', () => {
    if (process.platform === 'darwin') void shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone')
    else if (process.platform === 'win32') void shell.openExternal('ms-settings:privacy-microphone')
  })
  ipcMain.handle('speech:prepare', async () => {
    if (!d.speech) return { fake: true }
    await d.speech.ensure((f) => send('speech:progress', f))
    return { modelBase: `hob-file://f/${encodeURIComponent(d.speech.dir)}/` }
  })
  ipcMain.handle('models:list', () => d.setup.listModels())
  ipcMain.handle('models:use', (_e, id: string) => { void d.setup.useModel(id) })
  ipcMain.handle('models:remove', (_e, id: string) => d.setup.deleteModel(id))
  ipcMain.handle('storage:get', () => ({ modelsGB: (sizeOf(d.paths.models) + sizeOf(d.paths.speech)) / 1e9, filesGB: sizeOf(d.filesDir()) / 1e9, codeToolsGB: sizeOf(d.paths.python) / 1e9 }))

  ipcMain.handle('plugins:list', () => d.plugins.list())
  ipcMain.handle('plugins:setEnabled', (_e, id: string, on: boolean) => { d.plugins.setEnabled(String(id), !!on); pluginsChanged() })
  /** add a plugin folder, .zip or .mcpb; ones that run their own program ask first */
  const addPlugin = async (path: string, ask: boolean) => {
    const info = d.plugins.inspect(path)
    if (!info.ok) return info
    const win = d.win()
    if (ask && !d.fake && win) {
      const full = info.trust === 'full'
      const r = await dialog.showMessageBox(win, {
        type: full ? 'warning' : 'question', buttons: ['Add', 'Cancel'], defaultId: 0, cancelId: 1,
        message: `Add “${info.name}”?`,
        detail: full ? 'It runs its own program with full access to your computer. Only add plugins you trust.' : 'It adds new skills or tools to Hob.',
      })
      if (r.response !== 0) return null
    }
    const res = d.plugins.install(path)
    pluginsChanged()
    // start its app connection now so problems (or settings it needs) show on its card
    if (res.ok) d.plugins.warmUp()
    return res
  }
  ipcMain.handle('plugins:add', async () => {
    const r = await dialog.showOpenDialog({ title: 'Add a plugin', buttonLabel: 'Add', properties: ['openFile', 'openDirectory'], filters: [{ name: 'Hob plugin or MCP bundle', extensions: PLUGIN_FILES }] })
    if (r.canceled || !r.filePaths[0]) return null
    return addPlugin(r.filePaths[0], true)
  })
  // dropped on the Plugins screen
  ipcMain.handle('plugins:addFile', (_e, path: string) => addPlugin(String(path), true))
  ipcMain.handle('plugins:link', async () => {
    const r = await dialog.showOpenDialog({ title: 'Link a plugin folder', buttonLabel: 'Link', properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    const res = d.plugins.link(r.filePaths[0])
    pluginsChanged()
    return res
  })
  ipcMain.handle('plugins:remove', (_e, id: string) => { d.plugins.remove(String(id)); pluginsChanged() })
  ipcMain.handle('plugins:show', (_e, id: string) => { const p = d.plugins.list().find((x) => x.id === id); if (p) shell.showItemInFolder(p.dir) })
  ipcMain.handle('plugins:setSetting', (_e, id: string, key: string, value: string) => { d.plugins.setSetting(String(id), String(key), String(value ?? '')); pluginsChanged() })
  ipcMain.handle('plugins:saveSkill', (_e, s: NewSkill, replace?: boolean) => {
    const r = d.plugins.saveSkill({ name: String(s?.name ?? ''), description: String(s?.description ?? ''), instructions: String(s?.instructions ?? '') }, { replace: !!replace })
    pluginsChanged()
    return r
  })
  ipcMain.handle('plugins:getSkill', (_e, name: string) => {
    const s = d.plugins.findSkill(String(name))
    return s ? { name: s.name, description: s.description, instructions: s.body } : null
  })
  ipcMain.handle('plugins:removeSkill', (_e, name: string) => { d.plugins.removeSkill(String(name)); pluginsChanged() })
  ipcMain.handle('plugins:connectApp', async (_e, o: { name: string; command: string; env?: string }) => {
    const r = d.plugins.connectApp({ name: String(o?.name ?? ''), command: String(o?.command ?? ''), env: o?.env ? String(o.env) : undefined })
    pluginsChanged()
    return r
  })
  // connect now, opening the browser if the app asks the user to sign in; Cancel stops waiting
  const connecting = new Map<string, AbortController>()
  ipcMain.handle('plugins:connect', async (_e, id: string) => {
    connecting.get(id)?.abort()
    const ac = new AbortController()
    connecting.set(id, ac)
    try { return await d.plugins.connect(String(id), ac.signal) } finally {
      if (connecting.get(id) === ac) connecting.delete(id)
      pluginsChanged()
    }
  })
  ipcMain.handle('plugins:cancelConnect', (_e, id: string) => { connecting.get(String(id))?.abort() })
  ipcMain.handle('plugins:signOut', (_e, id: string) => { d.plugins.signOut(String(id)); pluginsChanged() })
  ipcMain.handle('plugins:choosePath', async (_e, kind: string, multiple: boolean) => {
    const r = await dialog.showOpenDialog({ properties: [kind === 'file' ? 'openFile' : 'openDirectory', ...(multiple ? ['multiSelections' as const] : [])] })
    return r.canceled ? [] : r.filePaths
  })
  ipcMain.handle('plugins:skills', () => d.plugins.skills().map(({ name, description, pluginId, pluginName, icon }) => ({ name, description, pluginId, pluginName, icon })))
  ipcMain.handle('plugins:starters', () => d.plugins.starters())

  return {
    /** an .mcpb or plugin .zip opened from Finder */
    async openPluginFile(path: string) {
      const r = await addPlugin(path, true)
      if (r) send('plugins:opened', r)
    },
  }
}
