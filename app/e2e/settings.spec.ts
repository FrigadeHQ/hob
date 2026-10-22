import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const main = join(import.meta.dirname, '../out/main/index.js')

test('Settings → Model: Change model opens the same picker as setup; the download shows its progress there', async () => {
  // a slow stand-in download: about 6 seconds
  const app = await electron.launch({ args: [main], env: { ...process.env, HOB_FAKE: '1', HOB_FAKE_STEP_MS: '1500', HOB_USER_DATA: mkdtempSync(join(tmpdir(), 'hob-e2e-')) } })
  const page = await app.firstWindow()
  await page.getByTestId('setup-download').click()
  await expect(page.getByTestId('status')).toHaveText(/^Ready$/, { timeout: 30_000 })
  await page.getByTestId('open-settings').click()
  await page.getByTestId('settings-nav-model').click()

  const current = page.getByTestId('settings-current-model')
  await expect(current).toContainText('Gemma 4 26B')
  await current.getByRole('button', { name: 'Change model' }).click()
  const dialog = page.getByRole('dialog', { name: 'Choose a model' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('radio', { name: /Gemma 4 26B/ })).toBeChecked()
  await expect(dialog.getByTestId('model-option').filter({ hasText: 'Gemma 4 26B' })).toContainText('In use')
  await dialog.getByTestId('model-option').filter({ hasText: 'gpt-oss 20B' }).click()
  await dialog.getByRole('button', { name: 'Use this model' }).click()
  await expect(dialog).toHaveCount(0)
  // right away: Settings says it's downloading, with a percentage, and nothing else can start
  await expect(current.getByTestId('model-progress')).toContainText(/Downloading|Starting/)
  await expect(current.getByRole('button', { name: 'Change model' })).toBeDisabled()
  await expect(current.getByTestId('model-progress')).toContainText(/\d+%/, { timeout: 10_000 })
  // done: it's the model in use
  await expect(current.locator('p').first()).toHaveText('gpt-oss 20B', { timeout: 20_000 })
  await expect(current.getByTestId('model-progress')).toHaveCount(0)
  await app.close()
})

test('Settings opens over the app; the theme can be System, Light or Dark and is remembered', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'hob-e2e-'))
  const launch = () => electron.launch({ args: [main], env: { ...process.env, HOB_FAKE: '1', HOB_USER_DATA: userData } })
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
  const app = await electron.launch({ args: [main], env: { ...process.env, HOB_FAKE: '1', HOB_FAKE_STEP_MS: '1500', HOB_USER_DATA: mkdtempSync(join(tmpdir(), 'hob-e2e-')) } })
  const page = await app.firstWindow()
  await page.getByTestId('setup-download').click()
  await expect(page.getByTestId('status')).toHaveText(/^Ready$/, { timeout: 30_000 })
  await page.getByTestId('open-settings').click()
  await page.getByTestId('settings-nav-model').click()
  const current = page.getByTestId('settings-current-model')
  await current.getByRole('button', { name: 'Change model' }).click()
  await page.getByTestId('model-option').filter({ hasText: 'gpt-oss 20B' }).click()
  await page.getByRole('button', { name: 'Use this model' }).click()
  await current.getByTestId('model-cancel').click()
  await expect(current.getByTestId('model-progress')).toHaveCount(0)
  await expect(current).toContainText('Gemma 4 26B')
  await expect(current.getByRole('button', { name: 'Change model' })).toBeEnabled()
  await expect(page.getByTestId('status')).toHaveText(/^Ready$/)
  await app.close()
})
