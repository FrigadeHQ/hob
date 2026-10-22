import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const main = join(import.meta.dirname, '../out/main/index.js')

test('charts: Hob draws them in the chat, and they download as PNG', async () => {
  const app = await electron.launch({ args: [main], env: { ...process.env, HOB_FAKE: '1', HOB_USER_DATA: mkdtempSync(join(tmpdir(), 'hob-e2e-')) } })
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(e.message))
  await page.getByTestId('setup-download').click()
  await expect(page.getByTestId('status')).toHaveText(/^Ready$/, { timeout: 20_000 })

  const chart = { type: 'bar', title: 'Sales by month', x: 'month', series: ['sales', 'costs'], unit: '€', data: [{ month: 'Jan', sales: 10, costs: 4 }, { month: 'Feb', sales: 30, costs: 8 }, { month: 'Mar', sales: 22, costs: 9 }] }
  await page.getByTestId('composer-input').fill(`__tools__ [["make_chart",${JSON.stringify(chart)}]]`)
  await page.getByTestId('composer-send').click()
  const card = page.getByTestId('chart-card')
  await expect(card).toBeVisible()
  await expect(card).toContainText('Sales by month')
  // a real drawing (SVG bars), not a picture of one
  await expect(card.locator('svg .recharts-bar-rectangle').first()).toBeVisible()
  await expect(card.getByTestId('chart-legend')).toContainText('costs')
  await expect(page.getByTestId('file-image')).toHaveCount(0)

  const out = join(mkdtempSync(join(tmpdir(), 'hob-png-')), 'chart.png')
  await app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = (async () => ({ canceled: false, filePath: p })) as never }, out)
  await card.getByTestId('chart-download').click()
  await expect.poll(() => { try { return readFileSync(out).subarray(1, 4).toString() } catch { return '' } }).toBe('PNG')
  expect(readFileSync(out).length).toBeGreaterThan(5000)

  // a pie and a line also draw; the chart survives reopening the chat
  await page.getByTestId('composer-input').fill(`__tools__ [["make_chart",${JSON.stringify({ ...chart, type: 'pie', title: 'Share', series: ['sales'] })}],["make_chart",${JSON.stringify({ ...chart, type: 'line', title: 'Trend' })}]]`)
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('chart-card')).toHaveCount(3)
  await expect(page.getByTestId('chart-card').nth(1).locator('.recharts-pie-sector').first()).toBeVisible()
  await page.getByTestId('new-chat').click()
  await page.getByTestId('chat-item').first().click()
  try {
    await expect(page.getByTestId('chart-card')).toHaveCount(3)
  } catch (err) {
    // what the screen showed, for the CI report
    await page.screenshot({ path: test.info().outputPath('reopened.png') })
    console.log('ERRORS', JSON.stringify(errors))
    throw err
  }

  // a chart drawn from a data file the code saved: just the chart, no card for the data file
  await page.getByTestId('new-chat').click()
  await page.getByTestId('composer-input').fill('__tools__ [["write_file",{"path":"totals.csv","content":"region,total\\nNorth,10\\nSouth,30\\n"}],["make_chart",{"type":"bar","title":"Totals","x":"region","series":["total"],"file":"totals.csv"}]]')
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('chart-card')).toHaveCount(1)
  await expect(page.getByTestId('file-card')).toHaveCount(0)
  await app.close()
})

test('a chart goes where the model wrote its placeholder ({chart}, [Chart: …]); without one, above the reply', async () => {
  const app = await electron.launch({ args: [main], env: { ...process.env, HOB_FAKE: '1', HOB_USER_DATA: mkdtempSync(join(tmpdir(), 'hob-e2e-')) } })
  const page = await app.firstWindow()
  await page.getByTestId('setup-download').click()
  await expect(page.getByTestId('status')).toHaveText(/^Ready$/, { timeout: 20_000 })
  const chart = { type: 'bar', title: 'Total Revenue by Region', x: 'region', series: ['revenue'], data: [{ region: 'North', revenue: 73000 }, { region: 'West', revenue: 52000 }] }
  // a newline in the box is typed with Shift+Enter; fill() puts it in directly
  await page.getByTestId('composer-input').fill(`__tools__ [["make_chart",${JSON.stringify(chart)}]]\n---\nHere is the comparison:\n\n[Chart: Total Revenue by Region]\n\nNorth leads with $73,000.`)
  await page.getByTestId('composer-send').click()
  const reply = page.getByTestId('message-assistant').last()
  await expect(reply).toContainText('North leads with $73,000.')
  await expect(reply).not.toContainText('[Chart')
  const box = async (text: string) => (await reply.getByText(text).boundingBox())!
  let card = (await reply.getByTestId('chart-card').boundingBox())!
  expect((await box('Here is the comparison:')).y).toBeLessThan(card.y)
  expect(card.y + card.height).toBeLessThanOrEqual((await box('North leads with $73,000.')).y)

  // Gemma's "{chart}"
  await page.getByTestId('composer-input').fill(`__tools__ [["make_chart",${JSON.stringify({ ...chart, title: 'Revenue' })}]]\n---\n**Revenue**\n\n{chart}\n\nWest is smallest.`)
  await page.getByTestId('composer-send').click()
  const second = page.getByTestId('message-assistant').last()
  await expect(second).toContainText('West is smallest.')
  await expect(second).not.toContainText('{chart}')
  card = (await second.getByTestId('chart-card').boundingBox())!
  expect(card.y + card.height).toBeLessThanOrEqual((await second.getByText('West is smallest.').boundingBox())!.y)

  // no placeholder: the chart sits above the text
  await page.getByTestId('composer-input').fill(`__tools__ [["make_chart",${JSON.stringify({ ...chart, title: 'Leaders' })}]]\n---\nNorth leads.`)
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('message-assistant').last()).toContainText('North leads.')
  card = (await page.getByTestId('chart-card').last().boundingBox())!
  expect(card.y + card.height).toBeLessThanOrEqual((await page.getByTestId('message-assistant').last().boundingBox())!.y)
  await app.close()
})
