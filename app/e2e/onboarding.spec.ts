import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const main = join(import.meta.dirname, '../out/main/index.js')

test('first run: recommend → download → chat', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'hob-e2e-'))
  const env = { ...process.env, HOB_FAKE: '1', HOB_USER_DATA: userData }
  const app = await electron.launch({ args: [main], env })
  const page = await app.firstWindow()

  // plain language: size rounded, no model name up front
  await expect(page.getByTestId('setup-recommended')).toContainText('13 GB')
  await expect(page.getByTestId('setup-recommended')).not.toContainText('gpt-oss')
  await page.getByTestId('setup-download').click()

  await expect(page.getByTestId('status')).toHaveText(/^Ready$/, { timeout: 20_000 })
  // grandma can start typing right away
  await expect(page.getByTestId('composer-input')).toBeFocused()

  // a suggestion sends straight away
  await page.locator('[data-testid="suggestion"][data-file="false"]').first().click()
  await expect(page.getByTestId('message-assistant').last()).toContainText('You said:')
  await page.getByTestId('new-chat').click()

  await page.getByTestId('composer-input').fill('hello there')
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('message-assistant').last()).toContainText('You said: hello there')

  // replies can be copied
  await app.evaluate(({ clipboard }) => clipboard.writeText(''))
  await page.getByTestId('copy-reply').last().click()
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toContain('You said: hello there')

  // Stop keeps what was written and says it stopped, not "couldn't come up with an answer"
  await page.getByTestId('composer-input').fill('__slow__')
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('message-assistant').last()).toContainText('one')
  await page.getByTestId('composer-stop').click()
  await expect(page.getByTestId('message-assistant').last()).toContainText('Stopped')
  await expect(page.getByTestId('message-assistant').last()).not.toContainText("couldn't")

  // New chat while a reply is running stops it and clears the screen
  await page.getByTestId('composer-input').fill('__slow__')
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('message-assistant').last()).toContainText('one')
  await page.getByTestId('new-chat').click()
  await expect(page.getByTestId('message-assistant')).toHaveCount(0)
  await page.waitForTimeout(600)
  await expect(page.getByTestId('message-assistant')).toHaveCount(0)
  await expect(page.getByTestId('composer-send')).toBeVisible()

  // thinking shows live instead of a dead "Thinking…", then gives way to the answer
  await page.getByTestId('composer-input').fill('__think__')
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('thinking-preview')).toContainText('weighing')
  await expect(page.getByTestId('message-assistant').last()).toContainText('Here is my answer')
  await expect(page.getByTestId('thinking-preview')).toHaveCount(0)

  // an empty model reply must not leave "Thinking…" on screen forever
  await page.getByTestId('composer-input').fill('__empty__')
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('message-assistant').last()).toContainText("couldn't come up with an answer")

  // I9: chat errors are plain English, no IPC jargon
  await page.getByTestId('composer-input').fill('__error__')
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('message-assistant').last()).toContainText('Something went wrong')
  await expect(page.getByTestId('message-assistant').last()).not.toContainText('invoking remote method')

  // I8: a link in a reply must not navigate the app window away
  await page.getByTestId('composer-input').fill('__link__')
  await page.getByTestId('composer-send').click()
  await page.getByRole('link', { name: 'example site' }).evaluate((a: HTMLAnchorElement) => a.click())
  await page.waitForTimeout(500)
  expect(page.url()).not.toContain('example.com')
  // Playwright's locator waits stall after a cancelled navigation; check the DOM directly.
  expect(await page.evaluate(() => !!document.querySelector('[data-testid="composer-input"]'))).toBe(true)

  await app.close()

  // relaunch → straight to chat
  const app2 = await electron.launch({ args: [main], env })
  const page2 = await app2.firstWindow()
  await expect(page2.getByTestId('composer-input')).toBeVisible()
  await app2.close()
})

test('choose a different model from the list', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'hob-e2e-'))
  const app = await electron.launch({ args: [main], env: { ...process.env, HOB_FAKE: '1', HOB_USER_DATA: userData } })
  const page = await app.firstWindow()

  await page.getByTestId('setup-other-options').click()
  const rows = page.getByTestId('model-option')
  expect(await rows.count()).toBeLessThanOrEqual(10)
  // too big for this computer: shown, but can't be picked
  await expect(rows.filter({ hasText: 'gpt-oss 120B' })).toBeDisabled()
  await expect(rows.filter({ hasText: 'gpt-oss 120B' })).toContainText('Needs more memory')
  await expect(rows.filter({ hasText: 'gpt-oss 20B' })).toContainText('Recommended')

  await rows.filter({ hasText: 'Qwen3 30B' }).click()
  await expect(page.getByTestId('model-option')).toHaveCount(0) // list closes
  await expect(page.getByTestId('setup-other-options')).toContainText('Qwen3 30B')
  await expect(page.getByTestId('setup-recommended')).toContainText('19 GB')

  await page.getByTestId('setup-download').click()
  await expect(page.getByTestId('status')).toHaveText(/^Ready$/, { timeout: 20_000 })
  await expect(page.getByTestId('status-tooltip')).toContainText('Qwen3 30B')
  await app.close()
})
