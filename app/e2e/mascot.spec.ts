import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('Hob moves from the greeting to the sidebar without watching the cursor', async () => {
  const app = await electron.launch({ args: [join(import.meta.dirname, '../out/main/index.js')], env: { ...process.env, HOB_FAKE: '1', HOB_USER_DATA: mkdtempSync(join(tmpdir(), 'hob-e2e-')) } })
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
    // Hob has a colour, not the art's grey
    await expect(mascot.locator('feColorMatrix')).toHaveCount(1)
    await expect(sidebarMascot).toBeHidden()
    await page.evaluate(() => document.fonts.ready)
    expect(await page.evaluate(() => document.fonts.check('16px "Hanken Grotesk"'))).toBe(true)
    if (process.env.HOB_SHOTS) await page.screenshot({ path: join(process.env.HOB_SHOTS, 'chat-new-light.png') })

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
    if (process.env.HOB_SHOTS) await page.screenshot({ path: join(process.env.HOB_SHOTS, 'chat-conversation-light.png') })
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(page.getByTestId('composer-input').locator('..')).toHaveCSS('background-color', 'rgb(34, 32, 30)')
    if (process.env.HOB_SHOTS) await page.screenshot({ path: join(process.env.HOB_SHOTS, 'chat-conversation-dark.png') })
    await page.getByTestId('new-chat').click()
    await expect(sidebarMascot).toBeHidden()
    await expect(mascot).toHaveAttribute('width', '48')
    await page.setViewportSize({ width: 720, height: 520 })
    await expect(page.getByTestId('sidebar-slot')).toHaveAttribute('aria-hidden', 'true')
    await expect.poll(async () => { const b = (await page.getByTestId('sidebar').boundingBox())!; return Math.round(b.x + b.width) }).toBe(0)
    // a new chat: the composer in the middle, three ideas under it
    await expect(page.getByTestId('suggestion')).toHaveCount(3)
    const firstIdea = (await page.getByTestId('suggestion').first().boundingBox())!
    const composer = (await page.getByTestId('composer-input').boundingBox())!
    expect(firstIdea.y).toBeGreaterThan(composer.y + composer.height)
    if (process.env.HOB_SHOTS) await page.screenshot({ path: join(process.env.HOB_SHOTS, 'chat-new-small-dark.png') })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true)
  } finally { await app.close() }
})

test('setup Hob follows the cursor, looks around, and respects reduced motion', async () => {
  const app = await electron.launch({ args: [join(import.meta.dirname, '../out/main/index.js')], env: { ...process.env, HOB_FAKE: '1', HOB_USER_DATA: mkdtempSync(join(tmpdir(), 'hob-e2e-')) } })
  try {
    const page = await app.firstWindow()
    // CI machines may have reduced motion on (Windows often does)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.clock.install()
    await page.reload()
    await expect(page.getByTestId('setup-download')).toBeVisible()
    await page.clock.pauseAt(new Date(Date.now() + 1000))
    const mascot = page.getByTestId('mascot')
    const eye = mascot.getByTestId('mascot-eyes').locator('rect').first()
    const box = (await mascot.boundingBox())!
    // the window's edges: its size differs between machines, and moves outside it send no events
    const { right, left } = await page.evaluate(() => ({ right: innerWidth - 4, left: 4 }))
    await page.mouse.move(right, box.y + box.height / 2)
    await expect(eye).toHaveAttribute('x', '18')
    await page.mouse.move(left, box.y + box.height / 2)
    await expect(eye).toHaveAttribute('x', '12')

    // Deterministic choices, while the real timers still drive the expressions and idle glances.
    await page.evaluate(() => { Math.random = () => .05 })
    await expect.poll(async () => { await page.clock.runFor(100); return mascot.getAttribute('data-expression') }, { intervals: [10] }).toBe('skeptical')
    await page.evaluate(() => { Math.random = () => .3 })
    await expect.poll(async () => { await page.clock.runFor(100); return mascot.getAttribute('data-expression') }, { intervals: [10] }).toBe('smile')
    await page.evaluate(() => { Math.random = () => .9 })
    await expect.poll(async () => { await page.clock.runFor(100); return mascot.getAttribute('data-expression') }, { intervals: [10] }).toBe('neutral-blink')
    await page.clock.runFor(4000)
    await expect(eye).not.toHaveAttribute('x', '12')

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(eye).toHaveAttribute('x', '15')
    await expect(mascot).toHaveAttribute('data-expression', 'neutral')
    await page.mouse.move(1000, 20)
    await page.clock.runFor(8000)
    await expect(eye).toHaveAttribute('x', '15')
    await expect(mascot).toHaveAttribute('data-expression', 'neutral')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await expect.poll(async () => {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.move(right, box.y + box.height / 2)
      return eye.getAttribute('x')
    }).toBe('18')
  } finally { await app.close() }
})
