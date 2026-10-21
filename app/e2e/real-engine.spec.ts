import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Opt-in: downloads the real ~1.8 GB starter model. Run with MABEL_REAL=1.
test.skip(process.env.MABEL_REAL !== '1', 'set MABEL_REAL=1 to run against the real engine')
test.setTimeout(20 * 60_000)

test('real engine: probe → download starter → load → chat', async () => {
  const userData = process.env.MABEL_REAL_USER_DATA ?? mkdtempSync(join(tmpdir(), 'mabel-real-'))
  const app = await electron.launch({ args: [join(import.meta.dirname, '../out/main/index.js')], env: { ...process.env, MABEL_USER_DATA: userData } })
  const page = await app.firstWindow()

  await expect(page.getByTestId('setup-recommended')).toBeVisible({ timeout: 60_000 })
  console.log('RECOMMENDED:', await page.getByTestId('setup-recommended').innerText())
  await page.evaluate(() => window.mabel.setup.confirm('qwen3-1.7b'))

  await expect(page.getByTestId('status')).toContainText('Ready', { timeout: 15 * 60_000 })
  await page.getByTestId('composer-input').fill('Reply with exactly: pong')
  const t0 = Date.now()
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('message-assistant').last()).toContainText(/pong/i, { timeout: 120_000 })
  console.log('REPLY:', JSON.stringify(await page.getByTestId('message-assistant').last().innerText()), 'in', Date.now() - t0, 'ms')
  await app.close()
})
