import type { ApprovalAnswer, ApprovalRequest } from '../../shared/agent'

/** Pending approval cards: one promise per request, settled by the user's answer or by Stop. */
export class Approvals {
  private pending = new Map<string, (a: ApprovalAnswer) => void>()
  constructor(private show: (req: ApprovalRequest) => void) {}

  wait(req: ApprovalRequest, signal: AbortSignal): Promise<ApprovalAnswer> {
    // a stopped turn never shows a card (an abort listener added now would never fire)
    if (signal.aborted) return Promise.resolve('deny')
    return new Promise((resolve) => {
      this.pending.set(req.id, resolve)
      signal.addEventListener('abort', () => { this.pending.delete(req.id); resolve('deny') }, { once: true })
      this.show(req)
    })
  }

  answer(id: string, answer: ApprovalAnswer) {
    this.pending.get(id)?.(answer === 'allow' || answer === 'always' ? answer : 'deny')
    this.pending.delete(id)
  }
}
