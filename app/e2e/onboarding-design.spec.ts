import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SetupState } from '../src/shared/types'

test('calm setup: bounded picker, real progress, finishing, and single-model details', async () => {
  const app = await electron.launch({ args: [join(import.meta.dirname, '../out/main/index.js')], env: {
    ...process.env, GARTH_FAKE: '1', GARTH_USER_DATA: mkdtempSync(join(tmpdir(), 'garth-design-')),
  } })
  try {
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 720, height: 520 })
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' })
    const send = (state: SetupState) => app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].webContents.send('setup:state', s), state)
    const change = page.getByTestId('setup-other-options')
    await expect(change).toBeVisible()
    if (process.env.GARTH_SHOTS) await page.screenshot({ path: join(process.env.GARTH_SHOTS, 'recommendation-light.png') })
    const original = await page.getByTestId('setup-recommended').boundingBox()
    const mascot = await page.getByTestId('mascot').elementHandle()
    await change.click()
    const dialog = page.getByRole('dialog', { name: 'Choose a model' })
    await expect(dialog).toBeVisible()
    await page.getByTestId('model-option').filter({ hasText: 'Qwen3 1.7B' }).click()
    await expect(page.getByTestId('setup-recommended')).toContainText('gpt-oss 20B')
    const bounds = await dialog.boundingBox()
    expect(bounds!.y).toBeGreaterThanOrEqual(24)
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(496)
    const lastOption = page.getByTestId('model-option').last()
    await lastOption.scrollIntoViewIfNeeded()
    const lastBounds = await lastOption.boundingBox()
    const footerBounds = await page.getByRole('button', { name: 'Use this model' }).boundingBox()
    expect(lastBounds!.y + lastBounds!.height).toBeLessThanOrEqual(footerBounds!.y)
    await page.keyboard.press('Escape')
    await expect(change).toBeFocused()
    expect(await page.getByTestId('setup-recommended').boundingBox()).toEqual(original)
    await change.click()
    await expect(dialog.getByRole('radio', { name: /gpt-oss 20B/ })).toBeChecked()
    await page.getByTestId('model-option').filter({ hasText: 'Qwen3 1.7B' }).click()
    await page.getByRole('button', { name: 'Use this model' }).click()
    await expect(page.getByTestId('setup-download-size')).toHaveText('1.9 GB download')
    await expect(change).toBeFocused()

    const target = { id: 'gpt-oss-20b', name: 'gpt-oss 20B', sizeGB: 12.11, estTokPerSec: 40, blurb: 'fast' }
    const starter = { ...target, id: 'qwen3-1.7b', name: 'Qwen3 1.7B', sizeGB: 1.83 }
    const downloading: SetupState = { phase: 'downloading', target, starter, progress: .25, etaSec: 120, chatReady: false }
    await send(downloading)
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25')
    await expect(page.getByTestId('setup-eta')).toHaveText('About 2 minutes left')
    expect(await page.getByTestId('setup-progress-card').boundingBox()).toEqual(original)
    expect(await mascot!.evaluate(el => el.isConnected)).toBe(true)
    await page.getByRole('button', { name: 'Download details' }).click()
    await expect(page.getByTestId('download-detail-row')).toHaveCount(2)
    await expect(page.getByTestId('download-detail-row').first()).toContainText('Qwen3 1.7B')
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await page.emulateMedia({ colorScheme: 'dark' })
    await send({ ...downloading, progress: 1 })
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
    await expect(page.getByTestId('setup-progress-card')).toContainText('Finishing setup')
    await expect(page.getByTestId('setup-eta')).toHaveText('Almost ready…')
    if (process.env.GARTH_SHOTS) await page.screenshot({ path: join(process.env.GARTH_SHOTS, 'finishing-dark.png') })
    await send({ ...downloading, target: starter, starter: undefined, progress: .5, etaSec: 0 })
    await expect(page.getByTestId('setup-eta')).toHaveText('Estimating time remaining…')
    await page.getByRole('button', { name: 'Download details' }).click()
    await expect(page.getByTestId('download-detail-row')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Download details' })).toBeFocused()
    await send({ phase: 'probing', firstRun: true })
    await expect(page.getByTestId('setup-probing')).toContainText('Starting Garth…')
    await expect(change).not.toBeVisible()
    const recommendation = await page.evaluate(() => window.garth.setup.getState())
    await send(recommendation)
    await expect(change).toBeVisible()
    expect(await mascot!.evaluate(el => el.isConnected)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  } finally { await app.close() }
})
