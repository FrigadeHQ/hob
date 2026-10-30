import { expect, it } from 'vitest'
import { chatFileName, chatMarkdown } from '../src/shared/chatExport'
import type { StoredMessage } from '../src/shared/agent'

const msg = (role: StoredMessage['role'], content: string, attachments: StoredMessage['attachments'] = []): StoredMessage => (
  { id: 1, role, content, attachments, steps: [], undoable: false, undone: false }
)

const labels = { you: 'You', attached: (names: string) => `Attached ${names}` }

it('writes the title, each speaker, the words, and attached file names', () => {
  const md = chatMarkdown(
    { title: 'Trip notes' },
    [
      msg('user', 'hello', [{ name: 'sales.csv', path: '/x/sales.csv', sizeBytes: 3 }]),
      msg('assistant', 'You said: hello'),
    ],
    labels,
  )
  expect(md).toBe('# Trip notes\n\n**You**\n\nhello\n\n_Attached sales.csv_\n\n**Hob**\n\nYou said: hello\n')
})

it('skips a reply with no words and no files', () => {
  expect(chatMarkdown({ title: 'Empty bits' }, [msg('assistant', '   ')], labels)).toBe('# Empty bits\n')
})

it('names the file from the title, without path characters', () => {
  expect(chatFileName('Trip notes')).toBe('Trip notes.md')
  expect(chatFileName('a/b:c')).toBe('a b c.md')
  expect(chatFileName('a*"b"?')).toBe('a b.md')
  expect(chatFileName('   ')).toBe('Chat.md')
})
