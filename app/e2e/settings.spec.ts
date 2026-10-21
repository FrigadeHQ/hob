import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const main = join(import.meta.dirname, '../out/main/index.js')

test('downloading another model in Settings shows its progress and blocks repeat clicks', async () => {
  // a slow stand-in download: about 6 seconds
  const app = await electron.launch({ args: [main], env: { ...process.env, GARTH_FAKE: '1', GARTH_FAKE_STEP_MS: '1500', GARTH_USER_DATA: mkdtempSync(join(tmpdir(), 'garth-e2e-')) } })
  const page = await app.firstWindow()
  await page.getByTestId('setup-download').click()
  await expect(page.getByTestId('status')).toHaveText(/^Ready$/, { timeout: 30_000 })
  await page.getByTestId('open-settings').click()
  await page.getByTestId('settings-nav-model').click()

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

test('Settings opens over the app; the theme can be System, Light or Dark and is remembered', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'garth-e2e-'))
  const launch = () => electron.launch({ args: [main], env: { ...process.env, GARTH_FAKE: '1', GARTH_USER_DATA: userData } })
  let app = await launch()
  let page = await app.firstWindow()
  await page.getByTestId('setup-download').click()
  await expect(page.getByTestId('status')).toHaveText(/^Ready$/, { timeout: 30_000 })
  await page.getByTestId('open-settings').click()
  await expect(page.getByTestId('settings')).toContainText('Appearance')
  await page.getByTestId('theme').getByRole('radio', { name: 'Dark' }).click()
  await expect.poll(() => app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark')
  // search narrows the list
  await page.getByTestId('settings-search').fill('calendar')
  await expect(page.getByTestId('settings-nav-connectors')).toBeVisible()
  await expect(page.getByTestId('settings-nav-model')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('settings')).toHaveCount(0)
  await app.close()
  app = await launch()
  page = await app.firstWindow()
  await expect(page.getByTestId('status')).toHaveText(/^Ready$/, { timeout: 30_000 })
  expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark')
  await app.close()
})

test('a model download in Settings can be cancelled, and chat stays on the current model', async () => {
  const app = await electron.launch({ args: [main], env: { ...process.env, GARTH_FAKE: '1', GARTH_FAKE_STEP_MS: '1500', GARTH_USER_DATA: mkdtempSync(join(tmpdir(), 'garth-e2e-')) } })
  const page = await app.firstWindow()
  await page.getByTestId('setup-download').click()
  await expect(page.getByTestId('status')).toHaveText(/^Ready$/, { timeout: 30_000 })
  await page.getByTestId('open-settings').click()
  await page.getByTestId('settings-nav-model').click()
  await expect(page.getByTestId('settings')).toContainText('runs well on this computer')
  const row = page.getByTestId('settings-model').filter({ has: page.getByTestId('model-use').filter({ hasText: 'Download' }) }).first()
  const name = (await row.locator('p').first().innerText()).trim()
  await row.getByTestId('model-use').click()
  const mine = page.getByTestId('settings-model').filter({ hasText: name })
  await mine.getByTestId('model-cancel').click()
  await expect(mine.getByTestId('model-progress')).toHaveCount(0)
  await expect(mine.getByTestId('model-use')).toHaveText('Download')
  await expect(page.getByTestId('status')).toHaveText(/^Ready$/)
  await app.close()
})
