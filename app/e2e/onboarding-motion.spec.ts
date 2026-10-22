import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SetupState } from '../src/shared/types'

test('Hob travels through setup into chat without fading out or losing a fast update', async () => {
  const app = await electron.launch({ args: [join(import.meta.dirname, '../out/main/index.js')], env: {
    ...process.env, HOB_FAKE: '1', HOB_USER_DATA: mkdtempSync(join(tmpdir(), 'hob-motion-')),
  } })
  try {
    const page = await app.firstWindow()
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await expect(page.getByTestId('setup-download')).toBeVisible()
    const recommendation = await page.evaluate(() => window.hob.setup.getState())
    const send = (state: SetupState) => app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].webContents.send('setup:state', s), state)
    // Observe the real browser transitions, including their named mascot snapshot.
    await page.evaluate(() => {
      const start = document.startViewTransition.bind(document)
      document.startViewTransition = (update) => {
        const transition = start(update)
        transition.ready.then(() => {
          const snapshot = getComputedStyle(document.documentElement, '::view-transition-new(hob-setup)')
          document.documentElement.dataset.mascotSnapshotOpacity = snapshot.opacity
          document.documentElement.dataset.motionCount = String(Number(document.documentElement.dataset.motionCount ?? 0) + 1)
        }).catch(() => {})
        return transition
      }
    })
    const root = page.locator('html')
    await send({ phase: 'probing', firstRun: true })
    await expect(root).toHaveAttribute('data-motion-count', '1')
    await send(recommendation)
    await expect(root).toHaveAttribute('data-motion-count', '2')
    await expect(root).toHaveAttribute('data-mascot-snapshot-opacity', '1')
    const setupMascot = page.getByTestId('mascot')
    await expect(setupMascot).toHaveCount(1)
    await expect(setupMascot).toHaveCSS('view-transition-name', 'hob-setup')
    const target = { id: 'gemma-4-26b-a4b', name: 'Gemma 4 26B', sizeGB: 14.44, estTokPerSec: 40, blurb: 'fast' }
    const download: SetupState = { phase: 'downloading', target, progress: .1, etaSec: 120, chatReady: false }
    await send(download)
    await send({ ...download, progress: .8 })
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '80')
    await expect(root).toHaveAttribute('data-motion-count', '3')
    await send({ phase: 'ready', model: target, liteMode: false })
    await expect(page.getByRole('heading', { name: 'What are we working on?' })).toBeVisible()
    await expect(root).toHaveAttribute('data-motion-count', '4')
    await expect(root).toHaveAttribute('data-mascot-snapshot-opacity', '1')
    await expect(page.locator('[data-testid=mascot]:visible')).toHaveCount(1)
    await expect(page.locator('.chat-greeting').getByTestId('mascot')).toHaveCSS('view-transition-name', 'hob-setup')

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await send({ phase: 'probing', firstRun: true })
    await expect(page.getByTestId('setup-probing')).toBeVisible()
    await send(recommendation)
    await expect(page.getByTestId('setup-download')).toBeVisible()
    await expect(root).toHaveAttribute('data-motion-count', '4')
  } finally { await app.close() }
})
