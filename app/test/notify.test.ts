import { describe, expect, it } from 'vitest'
import { Notices, type Notice } from '../src/main/notify'

function notices(focused: boolean, titles: Record<string, string> = { c1: 'Quarterly sales review' }) {
  const shown: Notice[] = []
  const opened: string[] = []
  const n = new Notices({ focused: () => focused, show: (x) => shown.push(x), open: (id) => opened.push(id), title: (id) => titles[id] })
  return { n, shown, opened }
}

describe('Notices', () => {
  it('stays quiet while the person is looking at Hob', () => {
    const { n, shown } = notices(true)
    n.replied('c1'); n.waiting('c1')
    expect(shown).toEqual([])
  })

  it('says a reply finished when Hob is in the background, and the click opens that chat', () => {
    const { n, shown, opened } = notices(false)
    n.replied('c1')
    expect(shown).toMatchObject([{ title: 'Quarterly sales review', body: 'Hob finished replying.' }])
    shown[0].onClick()
    expect(opened).toEqual(['c1'])
  })

  it('says when Hob is waiting for an OK', () => {
    const { n, shown } = notices(false)
    n.waiting('c1')
    expect(shown).toMatchObject([{ title: 'Quarterly sales review', body: 'Hob needs your OK to keep going.' }])
  })

  it('a chat without a real name yet is just "Hob"', () => {
    const { n, shown } = notices(false, { c2: 'New chat' })
    n.replied('c2'); n.replied('gone')
    expect(shown.map((s) => s.title)).toEqual(['Hob', 'Hob'])
  })
})
