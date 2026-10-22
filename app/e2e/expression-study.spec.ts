import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

test('expression study: every face, preview modes, appearance, and reduced motion', async () => {
  const app = await electron.launch({ args: [join(import.meta.dirname, '../out/main/index.js')], env: { ...process.env, HOB_FAKE: '1', HOB_USER_DATA: mkdtempSync(join(tmpdir(), 'hob-study-')) } })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.clock.install()
    await page.goto(pathToFileURL(join(import.meta.dirname, '../../design/hob-expressions/index.html')).href)
    await page.clock.pauseAt(new Date(Date.now() + 1000))
    const options = page.locator('.face-option')
    await expect(options).toHaveCount(14)
    for (const button of await options.all()) {
      const name = await button.locator('span').innerText()
      await button.click()
      await expect(page.locator('#face-name')).toHaveText(name)
      await expect(page.locator('.face-option[aria-pressed="true"]')).toHaveCount(1)
    }
    await page.getByLabel('Appearance').selectOption('dark')
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(25, 24, 23)')
    await page.getByLabel('Preview', { exact: true }).selectOption('setup')
    await page.locator('#hero').scrollIntoViewIfNeeded()
    const box = (await page.locator('#hero > svg').boundingBox())!
    await page.mouse.move(box.x + box.width / 2 + 400, box.y + box.height / 2)
    await expect(page.locator('#hero .eyes')).toHaveAttribute('transform', 'translate(3 0)')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.clock.runFor(8000)
    await expect(page.locator('#face-name')).toHaveText('Neutral')
    await expect(page.locator('#hero .eyes')).toHaveAttribute('transform', 'translate(0 0)')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.getByLabel('Preview', { exact: true }).selectOption('cycle')
    await page.clock.runFor(3000)
    await expect(page.locator('#face-name')).toHaveText('Warm smile')
    await page.locator('[data-face="curious"]').click()
    await page.clock.runFor(6000)
    await expect(page.locator('#face-name')).toHaveText('Curious')
    await expect(page.getByLabel('Preview', { exact: true })).toHaveValue('still')
    await page.getByLabel('Appearance').selectOption('light')
    await page.evaluate(() => document.fonts.ready)
    if (process.env.HOB_SHOTS) await page.screenshot({ path: join(process.env.HOB_SHOTS, 'expressions.png'), fullPage: true, scale: 'css' })
    await page.setViewportSize({ width: 320, height: 720 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(errors).toEqual([])
  } finally { await app.close() }
})
