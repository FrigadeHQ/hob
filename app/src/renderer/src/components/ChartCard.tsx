import { useEffect, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts'
import { validateChart, type ChartSpec } from '../../../shared/chart'
import { hob } from '../api'
import { language, t } from '../../../shared/i18n'

const HEIGHT = 280
const VARS = ['paper', 'surface', 'ink', 'ink-soft', 'muted', 'line', ...Array.from({ length: 8 }, (_, i) => `chart-${i + 1}`)] as const
type Colors = Record<(typeof VARS)[number], string>

/** the theme's colours as real values (an exported image can't read CSS variables); follows dark mode */
function useColors(): Colors {
  const read = () => {
    const css = getComputedStyle(document.documentElement)
    return Object.fromEntries(VARS.map((v) => [v, css.getPropertyValue(`--color-${v}`).trim()])) as Colors
  }
  const [colors, setColors] = useState(read)
  useEffect(() => {
    const m = window.matchMedia('(prefers-color-scheme: dark)')
    const on = () => setColors(read())
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return colors
}

const PREFIX = /^[€$£¥₹]$/
/** 1234.5 → "1,234.5" with the unit where people expect it: "€1,234.5", "12 kg", "40%" */
function format(n: unknown, unit?: string, compact = false): string {
  if (typeof n !== 'number') return String(n ?? '')
  const s = new Intl.NumberFormat(language(), compact ? { notation: 'compact', maximumFractionDigits: 1 } : { maximumFractionDigits: 2 }).format(n)
  if (!unit) return s
  return PREFIX.test(unit) ? `${unit}${s}` : unit === '%' ? `${s}%` : `${s} ${unit}`
}

type TipProps = { active?: boolean; payload?: { name?: string; value?: unknown; color?: string; payload?: { fill?: string } }[]; label?: unknown; unit?: string }
function Tip({ active, payload, label, unit }: TipProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-control border border-line bg-surface px-3 py-2 text-meta shadow-md">
      {label !== undefined && label !== '' && <p className="mb-1 font-medium text-ink">{String(label)}</p>}
      {payload.map((p, i) => (
        <p key={i} className="flex items-center gap-2 text-ink-soft">
          <span className="size-2 shrink-0 rounded-full" style={{ background: p.color ?? p.payload?.fill }} />
          {p.name}
          <span className="ms-auto ps-4 font-medium tabular-nums text-ink">{format(p.value, unit)}</span>
        </p>
      ))}
    </div>
  )
}

/** what the legend lists: the series, or for a pie the slices */
const legendItems = (spec: ChartSpec, color: (i: number) => string) =>
  spec.type === 'pie'
    ? (() => {
        const key = spec.series[0].key
        const total = spec.data.reduce((sum, r) => sum + (Number(r[key]) || 0), 0)
        return spec.data.map((r, i) => ({ label: total ? `${String(r[spec.x])} ${Math.round(((Number(r[key]) || 0) / total) * 100)}%` : String(r[spec.x]), color: color(i) }))
      })()
    : spec.series.length > 1 ? spec.series.map((s, i) => ({ label: s.label, color: color(i) })) : []

function Drawing({ spec, c }: { spec: ChartSpec; c: Colors }) {
  const color = (i: number) => c[`chart-${(i % 8) + 1}` as keyof Colors]
  const axis = { stroke: c.muted, tick: { fill: c.muted, fontSize: 12 }, tickLine: false, axisLine: false }
  const x = <XAxis dataKey={spec.x} {...axis} tickMargin={8} minTickGap={16} type={spec.type === 'scatter' ? 'number' : 'category'} />
  const y = <YAxis {...axis} width={56} tickFormatter={(v) => format(v, spec.unit, true)} />
  const grid = <CartesianGrid vertical={false} stroke={c.line} />
  const tip = <Tooltip content={<Tip unit={spec.unit} />} cursor={spec.type === 'bar' ? { fill: c.line, opacity: 0.5 } : { stroke: c.line }} />
  const margin = { top: 8, right: 8, bottom: 0, left: 0 }
  const stack = spec.stacked ? 'all' : undefined
  if (spec.type === 'pie') {
    const s = spec.series[0]
    return (
      <PieChart>
        {tip}
        <Pie data={spec.data} dataKey={s.key} nameKey={spec.x} innerRadius="58%" outerRadius="88%" paddingAngle={2} startAngle={90} endAngle={-270} stroke={c.surface} strokeWidth={2}>
          {spec.data.map((_, i) => <Cell key={i} fill={color(i)} />)}
        </Pie>
      </PieChart>
    )
  }
  if (spec.type === 'line') {
    return (
      <LineChart data={spec.data} margin={margin}>
        {grid}{x}{y}{tip}
        {spec.series.map((s, i) => <Line key={s.key} dataKey={s.key} name={s.label} type="monotone" stroke={color(i)} strokeWidth={2} dot={spec.data.length <= 24 ? { r: 3, fill: color(i), strokeWidth: 0 } : false} activeDot={{ r: 4 }} />)}
      </LineChart>
    )
  }
  if (spec.type === 'area') {
    return (
      <AreaChart data={spec.data} margin={margin}>
        <defs>
          {spec.series.map((s, i) => (
            <linearGradient key={s.key} id={`fill-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color(i)} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color(i)} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        {grid}{x}{y}{tip}
        {spec.series.map((s, i) => <Area key={s.key} dataKey={s.key} name={s.label} type="monotone" stackId={stack} stroke={color(i)} strokeWidth={2} fill={`url(#fill-${i})`} />)}
      </AreaChart>
    )
  }
  if (spec.type === 'scatter') {
    return (
      <ScatterChart margin={margin}>
        {grid}{x}{y}{tip}
        {spec.series.map((s, i) => <Scatter key={s.key} name={s.label} data={spec.data.map((r) => ({ [spec.x]: r[spec.x], [s.key]: r[s.key] }))} dataKey={s.key} fill={color(i)} />)}
      </ScatterChart>
    )
  }
  const last = spec.series.length - 1
  return (
    <BarChart data={spec.data} margin={margin} barCategoryGap="24%">
      {grid}{x}{y}{tip}
      {spec.series.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.label} stackId={stack} fill={color(i)} radius={!spec.stacked || i === last ? [4, 4, 0, 0] : 0} maxBarSize={48} />)}
    </BarChart>
  )
}

/** The chart as a 2x PNG: title, legend and drawing on the card's background. */
async function toPng(svg: SVGSVGElement, spec: ChartSpec, c: Colors, items: { label: string; color: string }[]): Promise<string> {
  const { width, height } = svg.getBoundingClientRect()
  const font = getComputedStyle(document.body).fontFamily
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(width)); clone.setAttribute('height', String(height))
  clone.setAttribute('font-family', font)
  const img = new Image()
  await new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}` })
  const pad = 24; const head = 32; const legend = items.length ? 28 : 0
  const canvas = document.createElement('canvas')
  canvas.width = (width + pad * 2) * 2; canvas.height = (height + head + legend + pad * 2) * 2
  const g = canvas.getContext('2d')!
  g.scale(2, 2)
  g.fillStyle = c.surface; g.fillRect(0, 0, canvas.width, canvas.height)
  g.fillStyle = c.ink; g.font = `600 15px ${font}`; g.textBaseline = 'middle'
  g.fillText(spec.title, pad, pad + 10)
  let lx = pad
  g.font = `12px ${font}`
  for (const it of items) {
    g.fillStyle = it.color; g.beginPath(); g.arc(lx + 4, pad + head + 6, 4, 0, Math.PI * 2); g.fill()
    g.fillStyle = c['ink-soft']; g.fillText(it.label, lx + 12, pad + head + 6)
    lx += 12 + g.measureText(it.label).width + 16
  }
  g.drawImage(img, pad, pad + head + legend, width, height)
  return canvas.toDataURL('image/png')
}

/** A chart Hob made (a .chart.json in the chat folder), drawn live; Download PNG saves an image of it. */
export function ChartCard({ path }: { path: string }) {
  const [spec, setSpec] = useState<ChartSpec | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const c = useColors()
  useEffect(() => {
    fetch(hob.fileUrl(path)).then((r) => r.json()).then((j) => {
      const v = validateChart(j)
      if ('error' in v) setError(t("This chart can't be shown."))
      else setSpec(v.spec)
    }).catch(() => setError(t("This chart can't be found any more.")))
  }, [path])
  if (error) return <p className="px-3 py-2 text-ui text-muted">{error}</p>
  if (!spec) return <div style={{ height: HEIGHT + 56 }} />
  const items = legendItems(spec, (i) => c[`chart-${(i % 8) + 1}` as keyof Colors])

  async function download() {
    const svg = box.current?.querySelector('svg.recharts-surface') as SVGSVGElement | null
    if (!svg || !spec) return
    const where = await hob.files.saveImage(await toPng(svg, spec, c, items), spec.title)
    if (where) { setSaved(where.split(/[\\/]/).pop() ?? where); setTimeout(() => setSaved(null), 3000) }
  }

  return (
    <div data-testid="chart-card" className="px-4 pt-3 pb-2">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-ui font-medium">{spec.title}</p>
        <button data-testid="chart-download" onClick={() => void download()} className="inline-flex shrink-0 items-center gap-1 rounded-control px-2 py-1 text-ui text-ink-soft hover:bg-line/70 hover:text-ink">
          <Download size={14} />{saved ? t('Saved {name}', { name: saved }) : t('Download PNG')}
        </button>
      </div>
      {items.length > 0 && (
        <div data-testid="chart-legend" className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {items.map((it) => <span key={it.label} className="inline-flex items-center gap-1.5 text-meta text-ink-soft"><span className="size-2 rounded-full" style={{ background: it.color }} />{it.label}</span>)}
        </div>
      )}
      <div ref={box} className="mt-2" style={{ height: HEIGHT }}>
        <ResponsiveContainer width="100%" height="100%">
          <Drawing spec={spec} c={c} />
        </ResponsiveContainer>
      </div>
    </div>
  )
}
