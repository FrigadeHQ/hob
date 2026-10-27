import { t } from '../shared/i18n'

export type Notice = { title: string; body: string; onClick: () => void }
type Deps = { focused(): boolean; show(n: Notice): void; open(chatId: string): void; title(chatId: string): string | undefined }

/** Tells the person when a reply is done, or Hob is waiting for them, while they're in another app. */
export class Notices {
  constructor(private d: Deps) {}

  replied(chatId: string) { this.post(chatId, t('Hob finished replying.')) }
  waiting(chatId: string) { this.post(chatId, t('Hob needs your OK to keep going.')) }

  private post(chatId: string, body: string) {
    // they're looking at it already
    if (this.d.focused()) return
    const title = this.d.title(chatId)
    // a chat is named after its first reply; until then it's just Hob
    this.d.show({ title: title && title !== 'New chat' ? title : 'Hob', body, onClick: () => this.d.open(chatId) })
  }
}
