/** A chart Hob draws itself (Recharts in the app), saved as <title>.chart.json in the chat folder. */
export const CHART_TYPES = ['bar', 'line', 'area', 'pie', 'scatter'] as const
export type ChartType = (typeof CHART_TYPES)[number]
export type ChartSeries = { key: string; label: string }
export type ChartSpec = {
  version: 1
  type: ChartType
  title: string
  /** the column along the bottom (pie: the slice names) */
  x: string
  series: ChartSeries[]
  data: Record<string, string | number | null>[]
  /** shown after numbers, e.g. "€" or "kg" */
  unit?: string
  /** bars or areas on top of each other */
  stacked?: boolean
}

export const MAX_ROWS = 2000
export const MAX_SERIES = 8

/** "1,234.5" → 1234.5; anything else that isn't a number → undefined */
function toNumber(v: unknown): number | null | undefined {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v !== 'string') return undefined
  const n = Number(v.trim().replace(/,(?=\d{3}\b)/g, '').replace(/[%€$£¥\s]/g, ''))
  return Number.isFinite(n) ? n : undefined
}

/** Check a chart the model asked for; the error says plainly what to fix. */
export function validateChart(input: unknown): { spec: ChartSpec } | { error: string } {
  const o = (input ?? {}) as Record<string, unknown>
  const fail = (why: string) => ({ error: `Can't draw this chart: ${why}` })
  const type = String(o.type ?? '') as ChartType
  if (!CHART_TYPES.includes(type)) return fail(`type must be one of ${CHART_TYPES.join(', ')}.`)
  const data = Array.isArray(o.data) ? o.data.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object') : []
  if (!data.length) return fail('there is no data. Give data as a list of rows, like [{"month": "Jan", "sales": 10}].')
  if (data.length > MAX_ROWS) return fail(`${data.length} rows is too many; at most ${MAX_ROWS}. Group or sum the data first.`)
  const x = String(o.x ?? '')
  if (!x || !data.some((r) => x in r)) return fail(`the rows have no column "${x}" for x. Columns: ${Object.keys(data[0]).join(', ')}.`)
  const raw = Array.isArray(o.series) ? o.series : typeof o.series === 'string' ? [o.series] : []
  const series: ChartSeries[] = raw.map((s) => (typeof s === 'string' ? { key: s, label: s } : { key: String((s as ChartSeries)?.key ?? ''), label: String((s as ChartSeries)?.label ?? (s as ChartSeries)?.key ?? '') }))
  if (!series.length) return fail('give at least one series: the column(s) with the numbers.')
  if (series.length > MAX_SERIES) return fail(`at most ${MAX_SERIES} series.`)
  if (type === 'pie' && series.length !== 1) return fail('a pie chart shows one series.')
  for (const s of series) if (!data.some((r) => s.key in r)) return fail(`the rows have no column "${s.key}". Columns: ${Object.keys(data[0]).join(', ')}.`)
  const out: ChartSpec['data'] = []
  for (const r of data) {
    const row: ChartSpec['data'][number] = {}
    const xv = r[x]
    if (type === 'scatter') {
      const n = toNumber(xv)
      if (n === undefined) return fail(`a scatter chart needs numbers in "${x}"; found "${String(xv)}".`)
      row[x] = n
    } else row[x] = xv === null || xv === undefined ? '' : typeof xv === 'number' ? xv : String(xv)
    for (const s of series) {
      const n = toNumber(r[s.key])
      if (n === undefined) return fail(`"${s.key}" must hold numbers; found "${String(r[s.key])}".`)
      row[s.key] = n
    }
    out.push(row)
  }
  const title = String(o.title ?? '').trim().slice(0, 120) || series.map((s) => s.label).join(' and ')
  const unit = typeof o.unit === 'string' && o.unit.trim() ? o.unit.trim().slice(0, 12) : undefined
  return { spec: { version: 1, type, title, x, series, data: out, ...(unit ? { unit } : {}), ...(o.stacked === true ? { stacked: true } : {}) } }
}

/** Plain CSV: a header row, commas, "quoted, values" */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []; let cell = ''; let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((v) => v !== '')) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some((v) => v !== '')) rows.push(row)
  const [head, ...body] = rows
  return head ? body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? '']))) : []
}
