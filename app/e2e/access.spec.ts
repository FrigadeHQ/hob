import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const main = join(import.meta.dirname, '../out/main/index.js')

test("a folder Hob can't use yet: access card, then one card for all the renames", async () => {
  // a pretend home with ~/Desktop/hob-test, which Hob hasn't been given
  const home = mkdtempSync(join(tmpdir(), 'hob-home-'))
  const photos = join(home, 'Desktop', 'hob-test')
  mkdirSync(photos, { recursive: true })
  for (const n of ['IMG_1.jpg', 'IMG_2.jpg']) writeFileSync(join(photos, n), n)
  const app = await electron.launch({ args: [main], env: { ...process.env, HOME: home, HOB_FAKE: '1', HOB_USER_DATA: mkdtempSync(join(tmpdir(), 'hob-e2e-')) } })
  const page = await app.firstWindow()
  await page.getByTestId('setup-download').click()
  await expect(page.getByTestId('status')).toHaveText(/^Ready$/, { timeout: 20_000 })

  await page.getByTestId('composer-input').fill('__tools__ [["list_files",{"path":"~/Desktop/hob-test"}]]')
  await page.getByTestId('composer-send').click()
  const card = page.getByTestId('approval')
  await expect(card).toHaveAttribute('data-access', 'true')
  await expect(card).toContainText('Let Hob use your “hob-test” folder?')
  await expect(card).toContainText('~/Desktop/hob-test in this chat')
  await expect(page.getByTestId('approval-always')).toHaveCount(0)
  await page.getByTestId('approval-allow').click()
  await expect(page.getByTestId('message-assistant').last()).toContainText('IMG_2.jpg')

  const moves = [1, 2].map((i) => ({ from: `~/Desktop/hob-test/IMG_${i}.jpg`, to: `~/Desktop/hob-test/2024-01-0${i}_001.jpg` }))
  await page.getByTestId('composer-input').fill(`__tools__ [["move_files",${JSON.stringify({ moves })}]]`)
  await page.getByTestId('composer-send').click()
  await expect(card).toContainText('Rename 2 files in hob-test?')
  await expect(page.getByTestId('approval-detail')).toContainText('IMG_2.jpg → 2024-01-02_001.jpg')
  await page.getByTestId('approval-allow').click()
  await expect(page.getByTestId('undo')).toBeVisible()
  expect(existsSync(join(photos, '2024-01-01_001.jpg'))).toBe(true)
  await page.getByTestId('undo').click()
  await expect.poll(() => existsSync(join(photos, 'IMG_1.jpg'))).toBe(true)
  await app.close()
})
