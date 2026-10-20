import type { ApprovalRequest, LiveSummary, LiveTurn, Step } from '../../shared/agent'

/** Replies keep going when the user switches chats; this remembers each one's progress until it's saved. */
export class LiveTurns {
  private byChat = new Map<string, LiveTurn>()
  private chatOf = new Map<string, string>()
  constructor(private changed: (list: LiveSummary[]) => void = () => {}) {}

  private turn(requestId: string) { const c = this.chatOf.get(requestId); return c ? this.byChat.get(c) : undefined }
  private notify() { this.changed(this.list()) }

  start(chatId: string, requestId: string) {
    this.byChat.set(chatId, { requestId, content: '', steps: [] })
    this.chatOf.set(requestId, chatId)
    this.notify()
  }
  token(requestId: string, text: string, thought = false) { const t = this.turn(requestId); if (t && !thought) t.content += text }
  reset(requestId: string) { const t = this.turn(requestId); if (t) t.content = '' }
  step(requestId: string, step: Step) {
    const t = this.turn(requestId)
    if (!t) return
    const i = t.steps.findIndex((s) => s.id === step.id)
    if (i === -1) t.steps.push(step); else t.steps[i] = step
  }
  approval(req: ApprovalRequest) { const t = this.turn(req.requestId); if (t) { t.approval = req; this.notify() } }
  answered(approvalId: string) {
    for (const t of this.byChat.values()) if (t.approval?.id === approvalId) { delete t.approval; this.notify() }
  }
  finish(requestId: string) {
    const c = this.chatOf.get(requestId)
    this.chatOf.delete(requestId)
    if (c && this.byChat.get(c)?.requestId === requestId) this.byChat.delete(c)
    this.notify()
  }
  get(chatId: string): LiveTurn | undefined { return this.byChat.get(chatId) }
  list(): LiveSummary[] { return [...this.byChat].map(([chatId, t]) => ({ chatId, waiting: !!t.approval })) }
}
