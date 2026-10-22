import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const main = join(import.meta.dirname, '../out/main/index.js')

test('settings explain reply size, unavailable models, and automatic image support', async () => {
  const app = await electron.launch({ args: [main], env: { ...process.env, HOB_FAKE: '1', HOB_USER_DATA: mkdtempSync(join(tmpdir(), 'hob-settings-')) } })
  try {
    const page = await app.firstWindow()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.getByTestId('setup-download').click()
    await expect(page.getByTestId('status')).toHaveText(/^Ready$/, { timeout: 30_000 })
    await page.getByTestId('open-settings').click()
    await page.getByTestId('theme').getByRole('radio', { name: 'Light', exact: true }).click()
    await expect(page.getByTestId('settings')).toContainText('Reply text size')
    const sample = page.getByTestId('reply-size-preview')
    await page.getByTestId('text-size').getByRole('radio', { name: 'Small' }).click()
    const small = await sample.evaluate((e) => parseFloat(getComputedStyle(e).fontSize))
    await page.getByTestId('text-size').getByRole('radio', { name: 'Large' }).click()
    expect(await sample.evaluate((e) => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThan(small)
    if (process.env.HOB_SHOTS) {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1280, height: 1060 }))
      await page.screenshot({ path: join(process.env.HOB_SHOTS, 'appearance.png'), scale: 'css' })
    }

    await page.getByTestId('settings-nav-model').click()
    await expect(page.getByTestId('settings-model').first()).not.toContainText(/very fast|all-rounder|everyday smarts/i)
    await expect(page.getByTestId('unavailable-model')).toHaveCount(0)
    await page.getByTestId('other-models').click()
    const blocked = page.getByTestId('unavailable-model')
    expect(await blocked.count()).toBeGreaterThan(0)
    await expect(blocked.filter({ hasText: 'gpt-oss 120B' })).toContainText('Needs more memory')
    await expect(blocked.getByTestId('model-use')).toHaveCount(0)
    await expect(blocked.getByRole('button')).toHaveCount(0)
    if (process.env.HOB_SHOTS) {
      await blocked.last().scrollIntoViewIfNeeded()
      await page.screenshot({ path: join(process.env.HOB_SHOTS, 'other-models.png'), scale: 'css' })
    }
    await page.getByTestId('other-models').click()
    await expect(blocked).toHaveCount(0)
    const sendVision = (state: import('../src/shared/types').VisionState) => app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].webContents.send('vision:state', s), state)
    await sendVision({ phase: 'off' })
    await expect(page.getByTestId('settings-vision')).toContainText('Not downloaded yet')
    await sendVision({ phase: 'downloading', progress: .42 })
    await expect(page.getByRole('progressbar', { name: 'Image support download' })).toHaveAttribute('aria-valuenow', '42')
    await sendVision({ phase: 'error', message: 'Connection interrupted' })
    await expect(page.getByTestId('settings-vision')).toContainText('Download interrupted')
    await page.getByRole('button', { name: 'Try again', exact: true }).click()
    await sendVision({ phase: 'ready', name: 'Qwen3-VL 4B', sizeGB: 2.9 })
    await expect(page.getByTestId('settings-vision')).toContainText('Downloaded')
    await expect(page.getByTestId('settings-vision')).toContainText('Added automatically')
    await expect(page.getByTestId('settings-vision')).toContainText('2.9 GB')
    await expect(page.getByTestId('settings-vision').getByTestId('model-use')).toHaveCount(0)
    if (process.env.HOB_SHOTS) {
      await page.getByRole('heading', { name: 'Models', exact: true }).scrollIntoViewIfNeeded()
      await page.screenshot({ path: join(process.env.HOB_SHOTS, 'models-light.png'), scale: 'css' })
      await page.getByTestId('settings-nav-general').click()
      await page.getByTestId('theme').getByRole('radio', { name: 'Dark', exact: true }).click()
      await expect.poll(() => app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark')
      await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
      await page.getByTestId('settings-nav-model').click()
      await page.screenshot({ path: join(process.env.HOB_SHOTS, 'models-dark.png'), scale: 'css' })
      await page.getByTestId('settings-nav-general').click()
      await page.getByTestId('theme').getByRole('radio', { name: 'Light', exact: true }).click()
      await expect.poll(() => app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('light')
      await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
      // Sparse screenshot fixtures: show a realistic footprint without downloading any models.
      const profile = await app.evaluate(({ app }) => app.getPath('userData'))
      for (const [folder, gb] of [['models', 23.54], ['vision', 3.02], ['python', .41]] as const) {
        mkdirSync(join(profile, folder), { recursive: true })
        const path = join(profile, folder, 'preview-footprint')
        writeFileSync(path, '')
        truncateSync(path, Math.round(gb * 1e9))
      }
      await page.getByTestId('settings-nav-files').click()
      await page.screenshot({ path: join(process.env.HOB_SHOTS, 'storage.png'), scale: 'css' })
      await page.getByTestId('settings-nav-model').click()
    }
    const spare = page.getByTestId('settings-model').filter({ has: page.getByTestId('model-delete') }).first()
    await expect(spare.getByTestId('model-use')).toHaveText('Use model')
    await expect(spare.getByTestId('model-delete')).toHaveText('Remove download')
    await spare.getByTestId('model-delete').click()
    await expect(page.getByTestId('settings-model').filter({ hasText: 'Gemma 4 E4B' }).getByTestId('model-use')).toHaveText('Download & use')
    await expect(page.getByTestId('status')).toHaveText(/^Ready$/)
    await page.setViewportSize({ width: 800, height: 600 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  } finally { await app.close() }
})

test('storage includes chat, image, and voice assets with an exact breakdown', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'hob-storage-'))
  for (const [folder, bytes] of [['models', 1000], ['vision/models', 2000], ['vision/server', 300], ['speech', 400]] as const) {
    mkdirSync(join(profile, folder), { recursive: true })
    writeFileSync(join(profile, folder, 'fixture'), Buffer.alloc(bytes))
  }
  const app = await electron.launch({ args: [main], env: { ...process.env, HOB_FAKE: '1', HOB_USER_DATA: profile } })
  try {
    const page = await app.firstWindow()
    const storage = await page.evaluate(() => window.hob.storage.get())
    expect(storage).toMatchObject({ chatModelsGB: 1000 / 1e9, imageSupportGB: 2300 / 1e9, voiceModelsGB: 400 / 1e9 })
    expect(storage.modelsGB).toBeCloseTo(3700 / 1e9, 12)
    expect(storage.modelsGB).toBeCloseTo(storage.chatModelsGB + storage.imageSupportGB + storage.voiceModelsGB, 12)
  } finally { await app.close() }
})
