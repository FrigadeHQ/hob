import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('formulas in a reply are drawn as math; prices stay text', async () => {
  const app = await electron.launch({ args: [join(import.meta.dirname, '../out/main/index.js')], env: { ...process.env, GARTH_FAKE: '1', GARTH_USER_DATA: mkdtempSync(join(tmpdir(), 'garth-e2e-')) } })
  try {
    const page = await app.firstWindow()
    await page.getByTestId('setup-download').click()
    await expect(page.getByTestId('status')).toHaveText(/^Ready$/, { timeout: 20_000 })
    const reply = 'The roots of \\(x^2 - 5x + 6 = 0\\) are:\n\\[\nx = \\frac{5 \\pm \\sqrt{1}}{2}\n\\]\nSo $x$ is 2 or 3. It cost $5 and $10.'
    await page.getByTestId('composer-input').fill(`__tools__ []\n---\n${reply}`)
    await page.getByTestId('composer-send').click()
    const msg = page.getByTestId('message-assistant').last()
    await expect(msg).toContainText('It cost $5 and $10.')
    await expect(msg.locator('.katex')).toHaveCount(3)
    await expect(msg.locator('.katex-display')).toHaveCount(1)
    await expect(msg.locator('.katex-display .mfrac')).toBeVisible()
    await expect(msg.locator('.katex-error')).toHaveCount(0)
    await expect(msg).not.toContainText('\\(')
    if (process.env.GARTH_SHOTS) await page.screenshot({ path: join(process.env.GARTH_SHOTS, 'math.png') })
  } finally { await app.close() }
})
