import { htmlToText } from './web'

/**
 * Annual reports filed as inline XBRL (.xhtml, as in Denmark and the EU) are megabytes of markup with the
 * figures tagged inside. Small models can't dig them out, and mixed up years when they tried. This reads the
 * tagged figures into plain tables, each under its exact period, current period first.
 */
type Fact = { name: string; ctx: string; value: string; unit?: string }
type Ctx = { period: string; instant: boolean; member?: string }

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]
/** "fsa:GrossProfitLoss" → "Gross profit loss" */
const label = (qname: string) => {
  const words = qname.replace(/^.*:/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function contexts(html: string): Map<string, Ctx> {
  const out = new Map<string, Ctx>()
  for (const m of html.matchAll(/<xbrli:context\b([^>]*)>([\s\S]*?)<\/xbrli:context>/g)) {
    const id = attr(m[1], 'id')
    if (!id) continue
    const body = m[2]
    const start = body.match(/<xbrli:startDate>([^<]+)</)?.[1], end = body.match(/<xbrli:endDate>([^<]+)</)?.[1]
    const instant = body.match(/<xbrli:instant>([^<]+)</)?.[1]
    const member = body.match(/<xbrldi:explicitMember[^>]*>([^<]+)</)?.[1] ?? body.match(/<xbrldi:typedMember[^>]*>([\s\S]*?)<\/xbrldi:typedMember>/)?.[1]
    out.set(id, {
      period: instant ?? `${start?.trim()} to ${end?.trim()}`,
      instant: !!instant,
      ...(member ? { member: /</.test(member) ? htmlToText(member) : label(member.trim()) } : {}),
    })
  }
  return out
}

/** the number as written ("8.706.672" in a comma-decimal format), its sign and scale → 8,706,672 */
function number(tag: string, text: string): string | null {
  const raw = htmlToText(text).trim()
  if (!raw || raw === '-' || raw === '–') return '0'
  const commaDecimal = /comma-?decimal|numcommadecimal/i.test(attr(tag, 'format') ?? '')
  const plain = commaDecimal ? raw.replace(/[.\s ]/g, '').replace(',', '.') : raw.replace(/[,\s ]/g, '')
  let n = Number(plain)
  if (!Number.isFinite(n)) return null
  n *= 10 ** Number(attr(tag, 'scale') ?? 0)
  if (attr(tag, 'sign') === '-' && n !== 0) n = -n
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

export function readReport(html: string): string | null {
  if (!/<ix:nonFraction\b/.test(html)) return null
  const ctxs = contexts(html)
  const facts: Fact[] = []
  for (const m of html.matchAll(/<ix:nonFraction\b([^>]*)>([\s\S]*?)<\/ix:nonFraction>/g)) {
    const name = attr(m[1], 'name'), ctx = attr(m[1], 'contextRef')
    const value = name && ctx ? number(m[1], m[2]) : null
    if (name && ctx && value !== null) facts.push({ name, ctx, value, unit: attr(m[1], 'unitRef') })
  }
  const texts: string[] = []
  for (const m of html.matchAll(/<ix:nonNumeric\b([^>]*)>([\s\S]*?)<\/ix:nonNumeric>/g)) {
    const name = attr(m[1], 'name'), t = htmlToText(m[2]).replace(/\n/g, ' ')
    // short facts only (names, dates, places): the long ones are the report's prose
    if (name && t && t.length <= 120 && !texts.some((x) => x.startsWith(`${label(name)}:`))) texts.push(`${label(name)}: ${t}`)
  }
  const company = texts.find((t) => /^Name of reporting entity:/.test(t))?.replace(/^[^:]+: /, '')
  const units = [...new Set(facts.map((f) => f.unit).filter((u) => u && !/^pure$/i.test(u)))].map((u) => u!.toUpperCase())

  const table = (instant: boolean) => {
    const rows = facts.filter((f) => { const c = ctxs.get(f.ctx); return c && c.instant === instant && !c.member })
    // latest period first: the current year, then the one before
    const periods = [...new Set(rows.map((f) => ctxs.get(f.ctx)!.period))].sort().reverse()
    if (!periods.length) return ''
    const names = [...new Set(rows.map((f) => f.name))]
    const cell = (n: string, p: string) => rows.find((f) => f.name === n && ctxs.get(f.ctx)!.period === p)?.value ?? ''
    return [
      `| Figure | ${periods.join(' | ')} |`, `|${' --- |'.repeat(periods.length + 1)}`,
      ...names.map((n) => `| ${label(n)} | ${periods.map((p) => cell(n, p)).join(' | ')} |`),
    ].join('\n')
  }
  const parts = facts.filter((f) => ctxs.get(f.ctx)?.member)
    .map((f) => { const c = ctxs.get(f.ctx)!; return `- ${label(f.name)} · ${c.member}, ${c.period}: ${f.value}` })

  return [
    'A financial report with tagged figures (inline XBRL). The figures below are read exactly from the tags; use these, not the page text.',
    company ? `Company: ${company}` : '',
    units.length ? `Amounts in ${units.join(', ')}. A minus sign is a loss or a negative amount.` : '',
    `\nFor each period (latest first):\n${table(false)}`,
    `\nAt each date (latest first):\n${table(true)}`,
    parts.length ? `\nBreakdowns (one part of a figure, not a total):\n${[...new Set(parts)].join('\n')}` : '',
    texts.length ? `\nOther details:\n${texts.map((t) => `- ${t}`).join('\n')}` : '',
  ].filter(Boolean).join('\n')
}
