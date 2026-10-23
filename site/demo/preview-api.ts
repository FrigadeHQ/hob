import { CHART, PROMPT } from './sequence'

const noop = () => {}
const liveListeners = new Set<(v: any[]) => void>()
let active = false
let working = false
let finished = false
const live = () => working ? [{ chatId: 'chart-demo', waiting: false }] : []

export function setPreviewChat(sent: boolean, running: boolean, done: boolean) {
  active = sent; finished = done
  if (working !== running) { working = running; liveListeners.forEach(fn => fn(live())) }
}

// Only the read-only UI's data providers exist here. No Electron, AI, filesystem, or account calls.
export const hob = {
  platform: 'darwin', fake: true,
  fileUrl: () => `data:application/json,${encodeURIComponent(JSON.stringify(CHART))}`,
  chats: {
    list: async () => [
      ...(active ? [{ id: 'chart-demo', title: finished ? 'Sales by region chart' : PROMPT }] : []),
      ...['Q4 planning notes', 'Weekend in Portland', 'Client proposal draft', 'A week of easy dinners', 'October spending', 'Team offsite agenda'].map((title, i) => ({ id: `history-${i}`, title })),
    ].map(c => ({ ...c, updatedAt: Date.now(), projectId: null })),
    onChanged: () => noop,
  },
  chat: { live: async () => live(), onLive: (fn: (v: any[]) => void) => { liveListeners.add(fn); return () => liveListeners.delete(fn) } },
  projects: { list: async () => [] },
  vision: { getState: async () => ({ phase: 'off' }), onState: () => noop },
}
export const canPreview = () => false
export const previewFile = noop
export const PdfThumb = () => null
