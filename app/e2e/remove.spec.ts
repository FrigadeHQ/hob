import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const main = join(import.meta.dirname, '../out/main/index.js')

test('Remove Hob deletes its models and data, then quits', async () => {
  const data = mkdtempSync(join(tmpdir(), 'hob-e2e-'))
  const app = await electron.launch({ args: [main], env: { ...process.env, HOB_FAKE: '1', HOB_USER_DATA: data } })
  const page = await app.firstWindow()
  await page.getByTestId('setup-download').click()
  await expect(page.getByTestId('status')).toHaveText(/^Ready$/, { timeout: 20_000 })
  expect(readdirSync(join(data, 'models')).length).toBeGreaterThan(0)

  await page.getByTestId('open-settings').click()
  await page.getByTestId('settings-nav-files').click()
  await page.getByTestId('remove-hob').click()
  // changing their mind keeps everything
  await page.getByTestId('confirm-remove-hob').getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByTestId('confirm-remove-hob')).toHaveCount(0)

  const quit = new Promise<void>((r) => app.process().once('exit', () => r()))
  await page.getByTestId('remove-hob').click()
  await page.getByTestId('confirm-remove-hob-yes').click()
  await quit
  await expect.poll(() => existsSync(data), { timeout: 15_000 }).toBe(false)
})
