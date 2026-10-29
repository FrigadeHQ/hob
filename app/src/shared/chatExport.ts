import type { StoredMessage } from './agent'
import { shownReply } from './replies'

/** A chat as a Markdown file: the title, then each message, with files listed under it. */
export function chatMarkdown(
  chat: { title: string },
  messages: StoredMessage[],
  labels: { you: string; attached: (names: string) => string },
): string {
  const out: string[] = [`# ${chat.title}`, '']
  for (const m of messages) {
    const text = (m.role === 'assistant' ? shownReply(m.content) : m.content).trim()
    const names = m.attachments.map((a) => a.name)
    if (!text && !names.length) continue
    out.push(m.role === 'user' ? labels.you : 'Hob', '')
    if (text) out.push(text, '')
    if (names.length) out.push(labels.attached(names.join(', ')), '')
  }
  return `${out.join('\n').trimEnd()}\n`
}

/** A file name from a chat title: no path characters, one line, not empty. */
export function chatFileName(title: string): string {
  const next = title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  return `${next || 'Chat'}.md`
}
