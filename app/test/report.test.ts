import { describe, expect, it } from 'vitest'
import { readReport } from '../src/main/tools/report'
import { htmlToText } from '../src/main/tools/web'

// a tiny inline XBRL annual report, shaped like the Danish ones (num-comma-decimal, sign, two years, a breakdown)
const ctx = (id: string, period: string, member = '') =>
  `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="http://www.dcca.dk/cvr">45015696</xbrli:identifier></xbrli:entity><xbrli:period>${period}</xbrli:period>${member ? `<xbrli:scenario><xbrldi:explicitMember dimension="fsa:ComponentsOfEquityAxis">${member}</xbrldi:explicitMember></xbrli:scenario>` : ''}</xbrli:context>`
const dur = (a: string, b: string) => `<xbrli:startDate>${a}</xbrli:startDate><xbrli:endDate>${b}</xbrli:endDate>`
const at = (d: string) => `<xbrli:instant>${d}</xbrli:instant>`
const num = (name: string, c: string, v: string, extra = '') => `<ix:nonFraction format="ixt:num-comma-decimal" decimals="0" scale="0" name="${name}" contextRef="${c}" unitRef="dkk"${extra}>${v}</ix:nonFraction>`
const REPORT = `<html><head><style>.a{color:red}</style></head><body><ix:header><ix:resources>
${ctx('c1', dur('2024-10-01', '2025-09-30'))}${ctx('c2', dur('2023-10-01', '2024-09-30'))}${ctx('c3', at('2025-09-30'))}${ctx('c4', at('2024-09-30'))}${ctx('c5', at('2025-09-30'), 'fsa:RetainedEarningsMember')}
</ix:resources></ix:header>
<p><ix:nonNumeric name="gsd:NameOfReportingEntity" contextRef="c1">M.M. Holding 2024 ApS</ix:nonNumeric></p>
<td>${num('fsa:GrossProfitLoss', 'c1', '11.547', ' sign="-"')}</td><td>${num('fsa:GrossProfitLoss', 'c2', '10.000', ' sign="-"')}</td>
<td>${num('fsa:ProfitLoss', 'c1', '8.706.672')}</td><td>${num('fsa:ProfitLoss', 'c2', '7.800')}</td>
<td>${num('fsa:Assets', 'c3', '128.638.446')}</td><td>${num('fsa:Assets', 'c4', '43.950.009')}</td>
<td>${num('fsa:Equity', 'c5', '52.601.679')}</td>
<ix:nonNumeric name="arr:OpinionOnAuditedFinancialStatements" contextRef="c1"><p>${'Long text. '.repeat(40)}</p></ix:nonNumeric>
</body></html>`

describe('readReport: a tagged annual report becomes plain tables', () => {
  const r = readReport(REPORT)!
  it('names the company and the unit', () => {
    expect(r).toContain('M.M. Holding 2024 ApS')
    expect(r).toContain('DKK')
  })
  it('puts each figure under its own period, current year first, with signs and plain numbers', () => {
    expect(r).toMatch(/\| Figure \| 2024-10-01 to 2025-09-30 \| 2023-10-01 to 2024-09-30 \|/)
    expect(r).toMatch(/\| Gross profit loss \| -11,547 \| -10,000 \|/)
    expect(r).toMatch(/\| Profit loss \| 8,706,672 \| 7,800 \|/)
    expect(r).toMatch(/\| Figure \| 2025-09-30 \| 2024-09-30 \|/)
    expect(r).toMatch(/\| Assets \| 128,638,446 \| 43,950,009 \|/)
  })
  it('keeps breakdowns apart from the totals', () => {
    expect(r).toMatch(/Equity · Retained earnings member, 2025-09-30: 52,601,679/)
    expect(r).not.toMatch(/\| Equity \| 52,601,679/)
  })
  it('leaves out long text facts', () => {
    expect(r).not.toContain('Long text.')
  })
  it('is null for a page without tagged figures', () => {
    expect(readReport('<html><body><p>Hello</p></body></html>')).toBeNull()
  })
})

describe('htmlToText: a saved web page as readable text', () => {
  it('drops markup, styles and scripts, keeps the words and line breaks', () => {
    expect(htmlToText('<html><head><style>p{}</style><script>x()</script></head><body><h1>Title</h1><p>One &amp; two</p><p>Three</p></body></html>'))
      .toBe('Title\nOne & two\nThree')
  })
})
