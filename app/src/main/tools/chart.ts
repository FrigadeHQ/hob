import { readFileSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { CHART_TYPES, parseCsv, validateChart } from '../../shared/chart'
import { isInside, uniqueName } from '../workspace'
import { resolvePath, type Tool, type TurnCtx } from '../agent/tool'

type ChartArgs = { type: string; title?: string; x: string; series: unknown; data?: unknown; file?: string; unit?: string; stacked?: boolean; fileError?: string }

/** "Sales / month?" → "Sales month" (a safe file name on every OS) */
const fileTitle = (t: string) => t.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Chart'
const target = (a: ChartArgs, ctx: TurnCtx) => join(ctx.chatDir, `${fileTitle(String(a.title ?? 'Chart'))}.chart.json`)

/** rows from a CSV or JSON file code saved in the chat folder */
function rowsFromFile(file: string, ctx: TurnCtx): { data?: unknown; fileError?: string } {
  const p = resolvePath(ctx, file)
  if (!isInside(ctx.chatDir, p)) return { fileError: `Couldn't use ${file}: it isn't in this chat's folder. Save it there with run_python first.` }
  try {
    const text = readFileSync(p, 'utf8')
    return { data: extname(p).toLowerCase() === '.json' ? JSON.parse(text) : parseCsv(text) }
  } catch {
    return { fileError: `Couldn't read ${file}. Save the data as CSV or JSON (a list of rows) in this chat's folder.` }
  }
}

export const makeChart: Tool<ChartArgs> = {
  spec: {
    name: 'make_chart',
    description: `Draw a clean, interactive chart in the chat (the user can download it as an image). Types: ${CHART_TYPES.join(', ')}. Give rows of data and which column goes along the bottom (x) and which hold the numbers (series). For big data, sum or group it with run_python first and save it as CSV, then pass file.`,
    params: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: [...CHART_TYPES] },
        title: { type: 'string' },
        x: { type: 'string', description: 'Column along the bottom (pie: the slice names)' },
        series: { type: 'array', items: { type: 'string' }, description: 'Column(s) with the numbers' },
        data: { type: 'array', items: { type: 'object' }, description: 'Rows, like [{"month": "Jan", "sales": 10}]' },
        file: { type: 'string', description: 'Or: a CSV or JSON file in the chat folder with the rows' },
        unit: { type: 'string', description: 'Optional, e.g. "€" or "kg"' },
        stacked: { type: 'boolean', description: 'Bars or areas on top of each other' },
      },
      required: ['type', 'x', 'series'],
    },
  },
  prepare: (a, ctx) => (a.file && !a.data ? { ...a, ...rowsFromFile(a.file, ctx) } : a),
  title: (a) => `Made a chart: ${a.title ?? a.type}`,
  action: (a, ctx) => ({ kind: 'create', paths: [target(a, ctx)] }),
  async run(a, ctx) {
    if (a.fileError) return { text: a.fileError, failed: true, title: "Couldn't make the chart" }
    const r = validateChart(a)
    if ('error' in r) return { text: r.error, failed: true, title: "Couldn't make the chart" }
    const p = join(ctx.chatDir, uniqueName(ctx.chatDir, `${fileTitle(r.spec.title)}.chart.json`))
    writeFileSync(p, JSON.stringify(r.spec))
    return { text: `Made the chart "${r.spec.title}". It shows in the chat; don't describe it again, just give the main takeaway.`, files: [p], ...(a.file ? { uses: [resolvePath(ctx, a.file)] } : {}) }
  },
}
