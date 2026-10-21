import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('Garth moves from the greeting to the sidebar without watching the cursor', async () => {
  const app = await electron.launch({ args: [join(import.meta.dirname, '../out/main/index.js')], env: { ...process.env, MABEL_FAKE: '1', MABEL_USER_DATA: mkdtempSync(join(tmpdir(), 'mabel-e2e-')) } })
  try {
    const page = await app.firstWindow()
    await page.emulateMedia({ colorScheme: 'light' })
    await page.getByTestId('setup-download').click()
    await expect(page.getByTestId('status')).toHaveText(/^Ready$/, { timeout: 20_000 })
    await expect(page.getByRole('heading', { name: 'What are we working on?' })).toBeVisible()
    const mascot = page.locator('[data-testid=mascot]:visible')
    const sidebarMascot = page.getByTestId('sidebar').getByTestId('mascot')
    await expect(mascot).toHaveCount(1)
    await expect(mascot).toHaveAttribute('width', '48')
    await expect(sidebarMascot).toBeHidden()
    await page.evaluate(() => document.fonts.ready)
    expect(await page.evaluate(() => document.fonts.check('16px "Hanken Grotesk"'))).toBe(true)
    if (process.env.MABEL_SHOTS) await page.screenshot({ path: join(process.env.MABEL_SHOTS, 'chat-new-light.png') })

    const eye = mascot.getByTestId('mascot-eyes').locator('rect').first()
    const x = await eye.getAttribute('x'), y = await eye.getAttribute('y')
    await page.mouse.move(0, 0)
    await page.mouse.move(900, 600, { steps: 5 })
    await expect(eye).toHaveAttribute('x', x!)
    await expect(eye).toHaveAttribute('y', y!)
    // Changing the OS preference also stops motion on an already mounted mascot.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(mascot.getByTestId('mascot-eyes')).toHaveCSS('animation-name', 'none')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await expect(mascot.getByTestId('mascot-eyes')).not.toHaveCSS('animation-name', 'none')

    await page.getByTestId('composer-input').fill('__slow__')
    await page.getByTestId('composer-send').click()
    await expect(sidebarMascot).toHaveAttribute('width', '24')
    await expect(sidebarMascot).toHaveAttribute('data-expression', 'working')
    await expect(mascot).toHaveCount(1)
    await expect(page.getByTestId('composer-stop')).toBeHidden({ timeout: 20_000 })
    await expect(sidebarMascot).toHaveAttribute('data-expression', 'neutral')
    await expect(page.getByTestId('message-assistant').last()).toHaveCSS('font-family', /Hanken Grotesk/)
    if (process.env.MABEL_SHOTS) await page.screenshot({ path: join(process.env.MABEL_SHOTS, 'chat-conversation-light.png') })
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(page.getByTestId('composer-input').locator('..')).toHaveCSS('background-color', 'rgb(34, 32, 30)')
    if (process.env.MABEL_SHOTS) await page.screenshot({ path: join(process.env.MABEL_SHOTS, 'chat-conversation-dark.png') })
    await page.getByTestId('new-chat').click()
    await expect(sidebarMascot).toBeHidden()
    await expect(mascot).toHaveAttribute('width', '48')
    await page.setViewportSize({ width: 720, height: 520 })
    await expect(page.getByTestId('sidebar-slot')).toHaveAttribute('aria-hidden', 'true')
    await expect.poll(async () => { const b = (await page.getByTestId('sidebar').boundingBox())!; return Math.round(b.x + b.width) }).toBe(0)
    const lastIdea = (await page.getByTestId('suggestion').last().boundingBox())!
    const composer = (await page.getByTestId('composer-input').boundingBox())!
    expect(lastIdea.y + lastIdea.height).toBeLessThan(composer.y - 40)
    if (process.env.MABEL_SHOTS) await page.screenshot({ path: join(process.env.MABEL_SHOTS, 'chat-new-small-dark.png') })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true)
  } finally { await app.close() }
})
