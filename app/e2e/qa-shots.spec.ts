import { _electron as electron, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Manual QA helper: screenshots every screen. Run with GARTH_SHOTS=<dir>.
const dir = process.env.GARTH_SHOTS
test.skip(!dir, 'set GARTH_SHOTS to capture screenshots')
const main = join(import.meta.dirname, '../out/main/index.js')

test('screens', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'garth-shots-'))
  const app = await electron.launch({ args: [main], env: { ...process.env, GARTH_FAKE: '1', GARTH_USER_DATA: userData, GARTH_FAKE_STEP_MS: '1500' } })
  const page = await app.firstWindow()
  const shot = (n: string) => page.screenshot({ path: join(dir!, `${n}.png`) })
  await page.getByTestId('setup-download').waitFor()
  await shot('01-welcome')
  await page.getByTestId('setup-other-options').click()
  await shot('02-options')
  await page.getByTestId('setup-other-options').click()
  await page.getByTestId('setup-download').click()
  await page.waitForTimeout(2000)
  await shot('03-downloading')
  await page.getByTestId('composer-input').waitFor({ timeout: 20_000 })
  await page.getByTestId('status').hover()
  await page.waitForTimeout(300)
  await shot('04-chat-empty-while-downloading')
  await page.getByTestId('composer-input').fill('Can you help me write a birthday card for my grandson?')
  await page.getByTestId('composer-send').click()
  await page.waitForTimeout(300)
  await shot('05-replying')
  await page.getByTestId('status').getByText('Ready').waitFor({ timeout: 30_000 })
  await shot('06-chat-ready')
  await page.setViewportSize({ width: 720, height: 520 })
  await shot('07-small-window')
  await page.setViewportSize({ width: 1100, height: 760 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await shot('08-dark')
  await page.getByTestId('new-chat').click()
  await shot('09-dark-empty')
  await app.close()
})

test('low disk', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'garth-shots-'))
  const app = await electron.launch({ args: [main], env: { ...process.env, GARTH_FAKE: '1', GARTH_USER_DATA: userData, GARTH_FAKE_FREE_GB: '15' } })
  const page = await app.firstWindow()
  await page.getByTestId('setup-download').waitFor()
  await page.screenshot({ path: join(dir!, '10-low-disk.png') })
  await app.close()
})
