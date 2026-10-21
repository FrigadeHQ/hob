/** In-flight turns by request id. A Stop can arrive before its turn starts (New chat right after Send). */
export class RunningTurns {
  private live = new Map<string, AbortController>()
  private early = new Set<string>()

  start(id: string): AbortController {
    const ac = new AbortController()
    if (this.early.delete(id)) ac.abort()
    this.live.set(id, ac)
    return ac
  }
  stop(id: string) {
    const ac = this.live.get(id)
    if (ac) ac.abort()
    else this.early.add(id)
  }
  stopAll() { for (const ac of this.live.values()) ac.abort() }
  finish(id: string) { this.live.delete(id) }
  get size() { return this.live.size }
}
