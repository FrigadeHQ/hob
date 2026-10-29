import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { ApprovalRequest, LiveSummary, Step, StoredMessage } from '../shared/agent'
import type { AccountsState, MacAccess, SetupState, HobApi, VisionState } from '../shared/types'
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
    pickDownloads: invoke('setup:pickDownloads'),
    onState: (cb) => listen<[SetupState]>('setup:state', cb),
  },
  chats: { list: invoke('chats:list'), search: invoke('chats:search'), get: invoke('chats:get'), create: invoke('chats:create'), save: invoke('chats:save'), remove: invoke('chats:remove'), keep: invoke('chats:keep'), removeAll: invoke('chats:removeAll'), onChanged: (cb) => listen<[]>('chats:changed', cb) },
  files: { add: invoke('files:add'), paste: invoke('files:paste'), pick: invoke('files:pick'), open: invoke('files:open'), show: invoke('files:show'), saveImage: invoke('files:saveImage') },
  projects: { list: invoke('projects:list'), create: invoke('projects:create'), update: invoke('projects:update'), remove: invoke('projects:remove'), pickFolders: invoke('projects:pickFolders'), checkFolders: invoke('projects:checkFolders'), open: invoke('projects:open') },
  chat: {
    send: invoke('chat:send'),
    warm: invoke('chat:warm'),
    stop: invoke('chat:stop'),
    onToken: (cb) => listen<[string, string, boolean]>('chat:token', cb),
    onStep: (cb) => listen<[string, Step]>('chat:step', cb),
    onReset: (cb) => listen<[string]>('chat:reset', cb),
    onApproval: (cb) => listen<[ApprovalRequest]>('chat:approval', cb),
    onDone: (cb) => listen<[string, StoredMessage | null]>('chat:done', cb),
    live: invoke('chat:live'),
    onLive: (cb) => listen<[LiveSummary[]]>('chat:live', cb),
    onOpen: (cb) => listen<[string]>('chat:open', cb),
  },
  approval: { answer: invoke('approval:answer') },
  mac: { access: invoke('mac:access'), ask: invoke('mac:ask'), openAccounts: invoke('mac:openAccounts'), onChanged: (cb) => listen<[MacAccess | null]>('mac:access', cb) },
  accounts: { get: invoke('accounts:get'), signIn: invoke('accounts:signIn'), cancel: invoke('accounts:cancel'), signOut: invoke('accounts:signOut'), onChanged: (cb) => listen<[AccountsState]>('accounts:changed', cb) },
  vision: { getState: invoke('vision:getState'), onState: (cb) => listen<[VisionState]>('vision:state', cb), retry: invoke('vision:retry') },
  task: { undo: invoke('task:undo') },
  settings: { get: invoke('settings:get'), set: invoke('settings:set'), pickFilesDir: invoke('settings:pickFilesDir') },
  models: { list: invoke('models:list'), use: invoke('models:use'), remove: invoke('models:remove'), cancel: invoke('models:cancel') },
  storage: { get: invoke('storage:get'), removeHob: invoke('storage:removeHob') },
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
