import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('mini Mabel in the status corner watches the cursor and laughs when tickled', async () => {
  const app = await electron.launch({ args: [join(import.meta.dirname, '../out/main/index.js')], env: { ...process.env, MABEL_FAKE: '1', MABEL_USER_DATA: mkdtempSync(join(tmpdir(), 'mabel-e2e-')) } })
  const page = await app.firstWindow()
  await page.getByTestId('setup-download').click()
  await expect(page.getByTestId('status')).toHaveText(/^Ready$/, { timeout: 20_000 })
  const mini = page.getByTestId('mascot-tickle')
  const eyeX = () => mini.locator('[data-testid=mascot-eyes] rect').first().getAttribute('x')
  const box = (await mini.boundingBox())!
  await page.mouse.move(box.x - 5, box.y + box.height / 2)
  await page.mouse.move(box.x + 600, box.y + box.height / 2, { steps: 4 })
  await expect.poll(eyeX).toBe('4')
  // up the sidebar, above her: she looks up
  const eyeY = () => mini.locator('[data-testid=mascot-eyes] rect').first().getAttribute('y')
  await page.mouse.move(box.x + box.width / 2, 20, { steps: 4 })
  await expect.poll(eyeY).toBe('2')
  await expect.poll(eyeX).toBe('3')
  await mini.click()
  await expect(mini.getByTestId('mascot')).toHaveAttribute('data-expression', 'laugh')
  await expect(mini.getByTestId('mascot')).not.toHaveAttribute('data-expression', 'laugh', { timeout: 3000 })
  await app.close()
})
