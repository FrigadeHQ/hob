import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { ApprovalRequest, Step } from '../shared/agent'
import type { SetupState, HobApi } from '../shared/types'
import type { PluginResult } from '../shared/plugins'

const invoke = (channel: string) => (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)
function listen<A extends unknown[]>(channel: string, cb: (...args: A) => void) {
  const h = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...(args as A))
  ipcRenderer.on(channel, h)
  return () => { ipcRenderer.off(channel, h) }
}

const api: HobApi = {
  platform: process.platform,
  fake: process.env.HOB_FAKE === '1',
  copy: invoke('copy'),
  pathsForFiles: (files) => files.map((f) => webUtils.getPathForFile(f)).filter(Boolean),
  fileUrl: (p) => `hob-file://f/${encodeURIComponent(p)}`,
  setup: {
    getState: invoke('setup:getState'),
    confirm: invoke('setup:confirm'),
    retry: invoke('setup:retry'),
    onState: (cb) => listen<[SetupState]>('setup:state', cb),
  },
  chats: { list: invoke('chats:list'), search: invoke('chats:search'), get: invoke('chats:get'), create: invoke('chats:create'), remove: invoke('chats:remove'), removeAll: invoke('chats:removeAll'), onChanged: (cb) => listen<[]>('chats:changed', cb) },
  files: { add: invoke('files:add'), pick: invoke('files:pick'), open: invoke('files:open'), show: invoke('files:show'), saveImage: invoke('files:saveImage') },
  projects: { list: invoke('projects:list'), create: invoke('projects:create'), update: invoke('projects:update'), remove: invoke('projects:remove'), pickFolders: invoke('projects:pickFolders'), checkFolders: invoke('projects:checkFolders'), open: invoke('projects:open') },
  chat: {
    send: invoke('chat:send'),
    stop: invoke('chat:stop'),
    onToken: (cb) => listen<[string, string, boolean]>('chat:token', cb),
    onStep: (cb) => listen<[string, Step]>('chat:step', cb),
    onReset: (cb) => listen<[string]>('chat:reset', cb),
    onApproval: (cb) => listen<[ApprovalRequest]>('chat:approval', cb),
  },
  approval: { answer: invoke('approval:answer') },
  task: { undo: invoke('task:undo') },
  settings: { get: invoke('settings:get'), set: invoke('settings:set'), pickFilesDir: invoke('settings:pickFilesDir') },
  models: { list: invoke('models:list'), use: invoke('models:use'), remove: invoke('models:remove') },
  storage: { get: invoke('storage:get') },
  plugins: {
    list: invoke('plugins:list'), setEnabled: invoke('plugins:setEnabled'), add: invoke('plugins:add'), link: invoke('plugins:link'),
    remove: invoke('plugins:remove'), show: invoke('plugins:show'), setSetting: invoke('plugins:setSetting'),
    saveSkill: invoke('plugins:saveSkill'), getSkill: invoke('plugins:getSkill'), removeSkill: invoke('plugins:removeSkill'),
    connectApp: invoke('plugins:connectApp'), skills: invoke('plugins:skills'), starters: invoke('plugins:starters'),
    addFile: invoke('plugins:addFile'), connect: invoke('plugins:connect'), cancelConnect: invoke('plugins:cancelConnect'),
    signOut: invoke('plugins:signOut'), choosePath: invoke('plugins:choosePath'),
    onChanged: (cb) => listen<[]>('plugins:changed', cb),
    onOpened: (cb) => listen<[PluginResult]>('plugins:opened', cb),
  },
  speech: { prepare: invoke('speech:prepare'), onProgress: (cb) => listen<[number]>('speech:progress', cb), mic: invoke('speech:mic'), openMicSettings: invoke('speech:micSettings') },
} as HobApi
contextBridge.exposeInMainWorld('hob', api)
