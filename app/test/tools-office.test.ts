import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { Journal } from '../src/main/agent/journal'
import type { TurnCtx } from '../src/main/agent/tool'
import { PY_PACKAGES, type PythonRuntime } from '../src/main/python/runtime'
import { readFile } from '../src/main/tools/files'

// Hob's own Python, when it's installed on this machine with the current packages
const root = join(homedir(), 'Library', 'Application Support', 'Hob', 'python')
const python = join(root, 'python', 'bin', 'python3')
const hasPptx = () => { try { execFileSync(python, ['-I', '-c', 'import pptx']); return true } catch { return false } }

it('Word, Excel and PowerPoint work out of the box: their packages come with Hob', () => {
  expect(PY_PACKAGES).toEqual(expect.arrayContaining(['python-docx==1.2.0', 'openpyxl==3.1.5', 'python-pptx==1.0.2', 'XlsxWriter==3.2.9']))
})

it.skipIf(!existsSync(python) || !hasPptx())('read_file shows what is in a Word document, a spreadsheet and a slide deck', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hob-office-'))
  const chatDir = join(dir, 'chat'); mkdirSync(chatDir)
  execFileSync(python, ['-I', '-c', `
import sys, os
from docx import Document
from openpyxl import Workbook
from pptx import Presentation
from pptx.util import Inches
os.chdir(sys.argv[1])
d = Document(); d.add_heading('Trip plan', 1); d.add_paragraph('Fly out Friday.')
t = d.add_table(rows=2, cols=2); t.cell(0, 0).text = 'Day'; t.cell(0, 1).text = 'City'; t.cell(1, 0).text = 'Sat'; t.cell(1, 1).text = 'Kyoto'
d.save('plan.docx')
wb = Workbook(); ws = wb.active; ws.title = 'Sales'; ws.append(['Region', 'Total']); ws.append(['North', 73000]); wb.save('sales.xlsx')
p = Presentation()
s = p.slides.add_slide(p.slide_layouts[1]); s.shapes.title.text = 'Q3 results'; s.placeholders[1].text = 'Revenue up 12%'
s.notes_slide.notes_text_frame.text = 'Mention the North region first'
s2 = p.slides.add_slide(p.slide_layouts[5]); s2.shapes.title.text = 'By region'
tb = s2.shapes.add_table(2, 2, Inches(1), Inches(2), Inches(6), Inches(1)).table
tb.cell(0, 0).text = 'Region'; tb.cell(0, 1).text = 'Total'; tb.cell(1, 0).text = 'North'; tb.cell(1, 1).text = '73,000'
p.save('deck.pptx')
`, chatDir])
  const ctx = {
    chatDir, grants: [], signal: new AbortController().signal, untrusted: false, webAccess: false,
    journal: new Journal({ backupDir: join(dir, 'undo'), save: () => {} }), trash: async () => {},
    python: { isReady: () => true, ensure: async () => python, dir: root } as unknown as PythonRuntime,
    runTmp: join(dir, 'tmp'), fetch: globalThis.fetch,
  } satisfies TurnCtx
  const read = async (name: string) => (await readFile.run({ path: name }, ctx)).text

  const deck = await read('deck.pptx')
  expect(deck).toContain('2 slides')
  expect(deck).toContain('--- slide 1: Q3 results')
  expect(deck).toContain('Revenue up 12%')
  expect(deck).toContain('Notes: Mention the North region first')
  expect(deck).toContain('--- slide 2: By region')
  expect(deck).toContain('Region | Total')
  expect(deck).toContain('North | 73,000')

  const doc = await read('plan.docx')
  expect(doc).toContain('Trip plan')
  expect(doc).toContain('Fly out Friday.')
  expect(doc).toContain('Sat | Kyoto')

  expect(await read('sales.xlsx')).toContain('North,73000')
})
