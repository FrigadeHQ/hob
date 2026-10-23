export const PROMPT = 'create a chart of the sales by region'
export const ATTACHMENT = { name: 'q3-sales.xlsx', path: 'q3-sales.xlsx', sizeBytes: 52000 }
export const REPLY = "I've created a bar chart of your sales by region for Q3, showing North as the highest-performing region."
export const CHART = {
  version: 1, type: 'bar', title: 'Sales by Region (Q3)', x: 'region', unit: '$',
  series: [{ key: 'sales', label: 'Sales' }],
  // Reproduces the four bar heights visible in Christian's recording; no customer file is included.
  data: [{ region: 'East', sales: 86000 }, { region: 'North', sales: 134000 },
    { region: 'South', sales: 104000 }, { region: 'West', sales: 86000 }],
}

export const TIMING = { type: 600, typed: 2400, drop: 2700, attach: 3100, send: 3700,
  read: 5700, aggregate: 7500, chart: 10000, reply: 10400, done: 12400, reset: 16600, end: 17200 }

const run = (id: string, status = 'done') => ({ id, tool: 'run_code', title: status === 'running' ? 'Running code…' : 'Ran code', status, detail: 'Read q3-sales.xlsx and grouped revenue by region.' })

export function frameAt(elapsed: number, reduced = false) {
  const t = reduced ? TIMING.done + 1000 : Math.max(0, elapsed) % TIMING.end
  const sent = t >= TIMING.send
  const done = t >= TIMING.done
  const chart = t >= TIMING.chart
  const steps = t < TIMING.read ? [] : [run('read', t < TIMING.aggregate ? 'running' : 'done')]
  if (t >= TIMING.aggregate) steps.push(run('aggregate', chart ? 'done' : 'running'))
  if (chart) steps.push({ id: 'chart', tool: 'chart', title: 'Made a chart: Sales by Region (Q3)', status: 'done', detail: 'Sales by Region (Q3)' })
  const thought = t < TIMING.aggregate ? 'I was looking for “Sales”, but the column is actually called “Revenue”.'
    : t < TIMING.chart ? 'I will rewrite the script to use Region and Revenue, aggregate them, and save to CSV.'
    : "I'll now create a bar chart of sales by region using the sales_by_region.csv file."
  const typed = Math.floor(Math.max(0, Math.min(1, (t - TIMING.type) / (TIMING.typed - TIMING.type))) * PROMPT.length)
  const replyWords = Math.floor(Math.max(0, Math.min(1, (t - TIMING.reply) / 1600)) * REPLY.split(' ').length)
  return { t, sent, done, chart, steps, thought, reduced, running: sent && !done,
    value: sent ? '' : PROMPT.slice(0, typed), attached: !sent && t >= TIMING.attach,
    dropping: t >= TIMING.drop && t < TIMING.attach,
    pressing: t >= TIMING.send - 160 && !sent,
    replyWords, summary: t >= TIMING.reply + 1650, fading: t >= TIMING.reset,
    phase: done ? 'complete' : chart ? 'chart' : t >= TIMING.aggregate ? 'aggregate' : t >= TIMING.read ? 'read' : sent ? 'thinking' : t >= TIMING.attach ? 'attached' : 'typing',
  }
}
export type DemoFrame = ReturnType<typeof frameAt>
