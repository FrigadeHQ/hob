import type { StoredMessage } from './agent'
import { shownReply } from './replies'

/** A chat as a Markdown file: the title, then each message, with the names of files added to it */
export function chatMarkdown(chat: { title: string }, messages: StoredMessage[], labels: { you: string; attached(names: string): string }): string {
  const out: string[] = [`# ${chat.title}`, '']
  for (const m of messages) {
    const text = (m.role === 'assistant' ? shownReply(m.content) : m.content).trim()
    const names = m.attachments.map((a) => a.name)
    if (!text && !names.length) continue
    out.push(`**${m.role === 'user' ? labels.you : 'Hob'}**`, '')
    if (text) out.push(text, '')
    if (names.length) out.push(`_${labels.attached(names.join(', '))}_`, '')
  }
  return `${out.join('\n').trimEnd()}\n`
}

/** A file name from a chat's title: no characters a path can't hold, never empty */
export function chatFileName(title: string): string {
  const name = title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  return `${name || 'Chat'}.md`
}
