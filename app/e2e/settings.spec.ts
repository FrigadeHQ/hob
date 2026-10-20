import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const main = join(import.meta.dirname, '../out/main/index.js')

test('downloading another model in Settings shows its progress and blocks repeat clicks', async () => {
  // a slow stand-in download: about 6 seconds
  const app = await electron.launch({ args: [main], env: { ...process.env, HOB_FAKE: '1', HOB_FAKE_STEP_MS: '1500', HOB_USER_DATA: mkdtempSync(join(tmpdir(), 'hob-e2e-')) } })
  const page = await app.firstWindow()
  await page.getByTestId('setup-download').click()
  await expect(page.getByTestId('status')).toHaveText(/^Ready$/, { timeout: 30_000 })
  await page.getByTestId('open-settings').click()

  const row = page.getByTestId('settings-model').filter({ has: page.getByTestId('model-use').filter({ hasText: 'Download' }) }).first()
  const name = (await row.locator('p').first().innerText()).trim()
  await row.getByTestId('model-use').click()
  // right away: the row says it's downloading, with a percentage, and nothing else can start
  const mine = page.getByTestId('settings-model').filter({ hasText: name })
  await expect(mine.getByTestId('model-progress')).toBeVisible()
  await expect(mine.getByTestId('model-progress')).toContainText(/Downloading|Starting/)
  await expect(mine.getByTestId('model-use')).toHaveCount(0)
  for (const b of await page.getByTestId('model-use').all()) await expect(b).toBeDisabled()
  await expect(mine.getByTestId('model-progress')).toContainText(/\d+%/, { timeout: 10_000 })
  // done: it's the model in use
  await expect(mine).toContainText('In use', { timeout: 20_000 })
  await expect(mine.getByTestId('model-progress')).toHaveCount(0)
  await app.close()
})
