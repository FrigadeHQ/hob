import { copyFileSync, existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { fillPdf, labelBlanks, pdfHelper, readPdf, runHelper, type PdfPage } from '../src/main/tools/pdf'
import { ensurePdfHelper } from './pdfHelper'

const fixtures = join(import.meta.dirname, 'fixtures')
const mac = process.platform === 'darwin'

beforeAll(ensurePdfHelper, 180_000)

const page = (o: Partial<PdfPage>): PdfPage => ({ n: 1, width: 612, height: 792, ocr: true, lines: [], blanks: [], ...o })
const L = (t: string, x: number, y: number, w: number, h = 12) => ({ t, x, y, w, h })
const line = (x: number, y: number, w: number) => ({ x, y, w, h: 1, kind: 'line' as const })

describe('labelBlanks: what each blank is for', () => {
  it('a label on the left, a caption under the line, two blanks on one row', () => {
    const r = labelBlanks(page({
      lines: [L('Name', 60, 160, 34), L('Last name', 130, 175, 48, 10), L('First name', 340, 175, 50, 10), L('Phone', 60, 215, 37)],
      blanks: [line(130, 172, 180), line(340, 172, 180), line(130, 227, 180)],
    }))
    expect(r.map((b) => [b.id, b.label])).toEqual([['p1:name-last-name', 'Name / Last name'], ['p1:name-first-name', 'Name / First name'], ['p1:phone', 'Phone']])
  })

  it('a table: row label on the left, column header above (not another blank’s caption)', () => {
    const r = labelBlanks(page({
      lines: [L('Date Leave to Begin', 230, 280, 93), L('Medical Leave', 60, 320, 80), L('Intermittent', 60, 352, 66)],
      blanks: [line(230, 332, 110), line(230, 364, 110)],
    }))
    expect(r.map((b) => b.label)).toEqual(['Medical Leave / Date Leave to Begin', 'Intermittent / Date Leave to Begin'])
  })

  it('a checkbox takes the words next to it; lines with no label at all are dropped (section rules, borders)', () => {
    const r = labelBlanks(page({
      lines: [L('• I agree to the terms', 59, 417, 125), L('A long paragraph of instructions that runs across the page', 46, 100, 500)],
      blanks: [{ x: 59.5, y: 420.5, w: 11.5, h: 11.5, kind: 'box' }, line(46, 93, 520)],
    }))
    expect(r.map((b) => [b.label, b.kind])).toEqual([['I agree to the terms', 'box']])
  })

  it('labels lose trailing underscores and colons', () => {
    const r = labelBlanks(page({ lines: [L('Cell Phone_', 340, 379, 59)], blanks: [line(394, 389, 126)] }))
    expect(r[0].label).toBe('Cell Phone')
  })
})

describe.runIf(mac)('read_pdf and fill_pdf with the PDF helper', () => {
  const ctxFor = () => {
    const chatDir = mkdtempSync(join(tmpdir(), 'hob-pdf-'))
    return { chatDir, grants: [], signal: new AbortController().signal, untrusted: false, webAccess: true, runTmp: chatDir } as never as Parameters<typeof readPdf.run>[1]
  }

  it('a page that is a picture (a scan, a photo saved as PDF) is read by the image model, which keeps tables and math', async () => {
    const ctx = ctxFor()
    copyFileSync(join(fixtures, 'table-scanned.pdf'), join(ctx.chatDir, 'homework.pdf'))
    const asked: { url: string; question: string }[] = []
    const vision = { state: () => ({ phase: 'ready' }), ask: async (url: string, question: string) => { asked.push({ url, question }); return '| | X | Y | Z |\n|---|---|---|---|\n| U | 2,1 | 0,0 | 3,2 |\n| D | 1,3 | 4,4 | 0,1 |' } }
    const out = await readPdf.run({ path: 'homework.pdf' }, { ...ctx, vision } as never)
    expect(asked).toHaveLength(1)
    expect(asked[0].url).toMatch(/^data:image\/(png|jpeg);base64,/)
    expect(asked[0].question).toMatch(/table/i)
    expect(out.text).toContain('| U | 2,1 | 0,0 | 3,2 |')
    expect(out.text).toMatch(/image model/i)
    // the recognized words come along: the image model can drop a sentence, recognition doesn't
    expect(out.text).toContain('Find every pure-strategy Nash equilibrium')
  })

  it("without the image model, a picture page falls back to recognized text and says tables may be out of order", async () => {
    const ctx = ctxFor()
    copyFileSync(join(fixtures, 'table-scanned.pdf'), join(ctx.chatDir, 'homework.pdf'))
    const out = await readPdf.run({ path: 'homework.pdf' }, { ...ctx, vision: { state: () => ({ phase: 'off' }), ask: async () => '' } } as never)
    expect(out.text).toContain('Find every pure-strategy Nash equilibrium')
    expect(out.text).toMatch(/tables .*out of order/i)
  })

  it('reads a scanned form: recognized text and a numbered list of blanks', async () => {
    const ctx = ctxFor()
    copyFileSync(join(fixtures, 'form-scanned.pdf'), join(ctx.chatDir, 'form.pdf'))
    const out = await readPdf.run({ path: 'form.pdf' }, ctx)
    expect(out.text).toContain('scanned')
    expect(out.text).toContain('LEAVE REQUEST FORM')
    for (const label of ['Name / Last name', 'First name', 'Phone', 'Medical Leave / Date Leave to Begin', 'Intermittent / Date Leave to End', 'I agree to the terms (checkbox)', 'Employee Signature', 'Date'])
      expect(out.text).toContain(label)
    expect(out.text.match(/\[p1:[a-z0-9-]+\]/g)).toHaveLength(10)
    // two blanks with the same name get told apart
    expect(out.text).toContain('[p1:date]')
    // the list of blanks comes before the pages' text, with how to go on
    expect(out.text.indexOf('Blanks to fill')).toBeLessThan(out.text.indexOf('--- Page 1'))
    expect(out.text).toMatch(/call fill_pdf right away/)
  }, 60_000)

  it('fills a scanned form into a new copy and the answers can be read back', async () => {
    const ctx = ctxFor()
    copyFileSync(join(fixtures, 'form-scanned.pdf'), join(ctx.chatDir, 'form.pdf'))
    const listed = (await readPdf.run({ path: 'form.pdf' }, ctx)).text
    const id = (label: string) => {
      const m = listed.match(new RegExp(`\\[(p1:[a-z0-9-]+)\\] ${label.replace(/[/()]/g, '\\$&')}`))
      if (!m) throw new Error(`no blank called "${label}" in:\n${listed}`)
      return m[1]
    }
    const out = await fillPdf.run({ path: 'form.pdf', answers: { [id('Name / Last name')]: 'Lovelace', [id('Name / First name')]: 'Ada', [id('I agree to the terms (checkbox)')]: 'yes' } }, ctx)
    expect(out.failed).toBeFalsy()
    expect(out.files).toEqual([join(ctx.chatDir, 'form (filled).pdf')])
    expect(out.text).toMatch(/Filled 3/)
    // "yes" on a line to write on is refused; filling again replaces the filled copy
    expect((await fillPdf.run({ path: 'form.pdf', answers: { [id('Phone')]: 'yes' } }, ctx)).text).toMatch(/not a checkbox/)
    expect((await fillPdf.run({ path: 'form.pdf', answers: { [id('Name / Last name')]: 'Lovelace', [id('Name / First name')]: 'Ada', [id('I agree to the terms (checkbox)')]: 'yes' } }, ctx)).files).toEqual([join(ctx.chatDir, 'form (filled).pdf')])
    expect(out.text).toContain('Still empty')
    const back = await runHelper(['read', join(ctx.chatDir, 'form (filled).pdf')])
    const text = back.pages[0].lines.map((l) => l.t).join(' ')
    expect(text).toContain('Lovelace')
    expect(text).toContain('Ada')
    // the original stays as it was
    expect((await runHelper(['read', join(ctx.chatDir, 'form.pdf')])).pages[0].lines.map((l) => l.t).join(' ')).not.toContain('Lovelace')
  }, 60_000)

  it('a whole address on the first of several lines is spread over the empty ones', async () => {
    const ctx = ctxFor()
    copyFileSync(join(fixtures, 'form-scanned.pdf'), join(ctx.chatDir, 'form.pdf'))
    const { spreadLines } = await import('../src/main/tools/pdf')
    const blanks = [{ id: 'p1:home-address', label: 'Home Address' }, { id: 'p1:home-address-line-2', label: 'Home Address (line 2)' }, { id: 'p1:home-address-line-3', label: 'Home Address (line 3)' }, { id: 'p1:phone', label: 'Phone' }]
    expect(spreadLines({ 'p1:home-address': '123 Market Street Apt 4B, San Francisco CA 94103', 'p1:phone': '555' }, blanks))
      .toEqual({ 'p1:home-address': '123 Market Street Apt 4B', 'p1:home-address-line-2': 'San Francisco CA 94103', 'p1:phone': '555' })
    // lines the model filled itself are left alone; with more parts than lines, the last line takes the rest
    expect(spreadLines({ 'p1:home-address': 'A, B', 'p1:home-address-line-2': 'C' }, blanks)).toEqual({ 'p1:home-address': 'A, B', 'p1:home-address-line-2': 'C' })
    expect(spreadLines({ 'p1:home-address': 'A, B, C, D' }, blanks)).toEqual({ 'p1:home-address': 'A', 'p1:home-address-line-2': 'B', 'p1:home-address-line-3': 'C, D' })
  })

  it('real form fields are listed by name and filled directly', async () => {
    const ctx = ctxFor()
    copyFileSync(join(fixtures, 'form-fields.pdf'), join(ctx.chatDir, 'club.pdf'))
    const listed = (await readPdf.run({ path: 'club.pdf' }, ctx)).text
    expect(listed).toContain('[f:full_name]')
    expect(listed).toContain('[f:newsletter]')
    await fillPdf.run({ path: 'club.pdf', answers: { 'f:full_name': 'Ada Lovelace', 'f:newsletter': 'yes' } }, ctx)
    const back = await runHelper(['read', join(ctx.chatDir, 'club (filled).pdf')])
    expect(back.fields.find((f) => f.name === 'full_name')?.value).toBe('Ada Lovelace')
    expect(back.fields.find((f) => f.name === 'newsletter')?.value).toBe('on')
  }, 60_000)

  it('an unknown blank id is explained, nothing is saved', async () => {
    const ctx = ctxFor()
    copyFileSync(join(fixtures, 'form-scanned.pdf'), join(ctx.chatDir, 'form.pdf'))
    const out = await fillPdf.run({ path: 'form.pdf', answers: { 'p9:nope': 'x' } }, ctx)
    expect(out.failed).toBe(true)
    expect(out.text).toMatch(/p9:nope/)
    // the real ids come with the error, so the model can fix the call without reading again
    expect(out.text).toContain('p1:name-last-name')
    expect(existsSync(join(ctx.chatDir, 'form (filled).pdf'))).toBe(false)
  }, 60_000)
})

describe('labelBlanks: real-world forms', () => {
  it('extra lines under a labeled blank continue it (address line 2, 3)', () => {
    const r = labelBlanks(page({ lines: [L('Home Address', 50, 303, 77)], blanks: [line(124, 313, 180), line(124, 338, 180), line(124, 364, 180)] }))
    expect(r.map((b) => b.label)).toEqual(['Home Address', 'Home Address (line 2)', 'Home Address (line 3)'])
  })
  it('a blank labelled only "(1)" or "_" is dropped', () => {
    expect(labelBlanks(page({ lines: [L('(1)', 59, 195, 18), L('_ (3)', 110, 195, 29)], blanks: [line(80, 205, 25), line(142, 205, 25)] }))).toEqual([])
  })
  it('sentences are not labels, and page-wide rules need a label on their left', () => {
    const r = labelBlanks(page({
      lines: [L('Note: Persons are not required to respond to this collection of information unless it displays a valid number', 52, 600, 400), L('Page 1 of 4', 46, 748, 50), L('Explain', 46, 400, 40)],
      blanks: [line(52, 598, 450), line(42, 744, 519), line(95, 410, 470)],
    }))
    expect(r.map((b) => b.label)).toEqual(['Explain'])
  })
})
