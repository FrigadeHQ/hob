import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const main = join(import.meta.dirname, '../out/main/index.js')

test('downloading another model in Settings shows its progress and blocks repeat clicks', async () => {
  // a slow stand-in download: about 6 seconds
  const app = await electron.launch({ args: [main], env: { ...process.env, HOB_FAKE: '1', HOB_FAKE_STEP_MS: '1500', HOB_USER_DATA: mkdtempSync(join(tmpdir(), 'hob-e2e-')) } })
  const page = await app.firstWindow()
  await page.getByTestId('setup-download').click()
  await expect(page.getByTestId('status')).toHaveText(/^Getting smarter… \d+%$/, { timeout: 15_000 })
  await expect(page.getByTestId('status-tooltip')).toContainText('Downloading Gemma 4 26B')
  await expect(page.getByTestId('status-tooltip')).not.toContainText('smarter model')
  await expect(page.getByTestId('status')).toHaveText(/^Ready$/, { timeout: 30_000 })
  await page.getByTestId('open-settings').click()
  await page.getByTestId('settings-nav-model').click()

  const row = page.getByTestId('settings-model').filter({ has: page.getByTestId('model-use').filter({ hasText: 'Download' }) }).last()
  const name = (await row.locator('p').first().innerText()).trim()
  await row.getByTestId('model-use').click()
  // right away: the row says it's downloading, with a percentage, and nothing else can start
  const mine = page.getByTestId('settings-model').filter({ hasText: name })
  await expect(mine.getByTestId('model-progress')).toBeVisible()
  await expect(page.getByTestId('status')).toContainText(`Downloading ${name}…`)
  await expect(page.getByTestId('status-tooltip')).toContainText(`Downloading ${name}`)
  await expect(page.getByTestId('status-tooltip')).not.toContainText('smarter')
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
  await expect(page.getByTestId('settings')).toContainText('Choose a chat model for this computer')
  const row = page.getByTestId('settings-model').filter({ has: page.getByTestId('model-use').filter({ hasText: 'Download' }) }).first()
  const name = (await row.locator('p').first().innerText()).trim()
  await row.getByTestId('model-use').click()
  const mine = page.getByTestId('settings-model').filter({ hasText: name })
  await mine.getByTestId('model-cancel').click()
  await expect(mine.getByTestId('model-progress')).toHaveCount(0)
  await expect(mine.getByTestId('model-use')).toHaveText('Download & use')
  await expect(page.getByTestId('status')).toHaveText(/^Ready$/)
  await app.close()
})

test('Hob starts in the computer’s language, and the language can be changed in Settings', async () => {
  const de = JSON.parse(readFileSync(join(import.meta.dirname, '../src/shared/locales/de.json'), 'utf8'))
  const userData = mkdtempSync(join(tmpdir(), 'hob-e2e-'))
  const launch = () => electron.launch({ args: [main], env: { ...process.env, HOB_FAKE: '1', HOB_SYSTEM_LANGUAGES: 'de-DE,en-US', HOB_USER_DATA: userData } })
  let app = await launch()
  let page = await app.firstWindow()
  // German computer: German from the first screen
  await expect(page.getByTestId('setup-download')).toHaveText(de['Download and start'])
  await expect(page.locator('html')).toHaveAttribute('lang', 'de')
  await page.getByTestId('setup-download').click()
  await page.getByTestId('open-settings').click()
  await expect(page.getByTestId('settings-language')).toHaveValue('')
  await expect(page.getByTestId('settings-language').locator('option').first()).toContainText('Deutsch')

  // Arabic: right to left, straight away
  await page.getByTestId('settings-language').selectOption('ar')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar')

  // English, and it stays English after a restart
  await page.getByTestId('settings-language').selectOption('en')
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
  await expect(page.getByTestId('settings-nav-general')).toHaveText('General')
  await app.close()
  app = await launch()
  page = await app.firstWindow()
  await expect(page.getByTestId('open-settings')).toHaveAttribute('aria-label', 'Settings')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')

  // back to the computer's: German again
  await page.getByTestId('open-settings').click()
  await page.getByTestId('settings-language').selectOption('')
  await expect(page.getByTestId('settings-nav-general')).toHaveText(de['General'])
  await app.close()
})

test('in another language, Hob shows that it’s thinking but not its English thoughts', async () => {
  const de = JSON.parse(readFileSync(join(import.meta.dirname, '../src/shared/locales/de.json'), 'utf8'))
  const app = await electron.launch({ args: [main], env: { ...process.env, HOB_FAKE: '1', HOB_SYSTEM_LANGUAGES: 'de-DE', HOB_USER_DATA: mkdtempSync(join(tmpdir(), 'hob-e2e-')) } })
  const page = await app.firstWindow()
  await page.getByTestId('setup-download').click()
  await page.getByTestId('composer-input').fill('__think__')
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('thinking')).toContainText(de['Thinking'])
  // watch until the answer: in English the stand-in model's thoughts show after about 3 s
  let shown = false
  while (!(await page.getByTestId('message-assistant').last().textContent())?.includes('Here is my answer')) {
    shown ||= (await page.getByTestId('thinking-preview').count()) > 0
    await page.waitForTimeout(100)
  }
  expect(shown).toBe(false)
  await app.close()
})
