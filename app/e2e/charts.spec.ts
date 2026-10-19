import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const main = join(import.meta.dirname, '../out/main/index.js')

test('charts: Hob draws them in the chat, and they download as PNG', async () => {
  const app = await electron.launch({ args: [main], env: { ...process.env, HOB_FAKE: '1', HOB_USER_DATA: mkdtempSync(join(tmpdir(), 'hob-e2e-')) } })
  const page = await app.firstWindow()
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
  await expect(page.getByTestId('chart-card')).toHaveCount(3)

  // a chart drawn from a data file the code saved: just the chart, no card for the data file
  await page.getByTestId('new-chat').click()
  await page.getByTestId('composer-input').fill('__tools__ [["write_file",{"path":"totals.csv","content":"region,total\\nNorth,10\\nSouth,30\\n"}],["make_chart",{"type":"bar","title":"Totals","x":"region","series":["total"],"file":"totals.csv"}]]')
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('chart-card')).toHaveCount(1)
  await expect(page.getByTestId('file-card')).toHaveCount(0)
  await app.close()
})
