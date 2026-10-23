import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('Hob follows the cursor in the greeting and settles in the sidebar', async () => {
  const app = await electron.launch({ args: [join(import.meta.dirname, '../out/main/index.js')], env: { ...process.env, HOB_FAKE: '1', HOB_USER_DATA: mkdtempSync(join(tmpdir(), 'hob-e2e-')) } })
  try {
    const page = await app.firstWindow()
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' })
    await page.getByTestId('setup-download').click()
    await expect(page.getByTestId('status')).toHaveText(/^Ready$/, { timeout: 20_000 })
    await expect(page.getByRole('heading', { name: 'What are we working on?' })).toBeVisible()
    const mascot = page.locator('[data-testid=mascot]:visible')
    const sidebarMascot = page.getByTestId('sidebar').getByTestId('mascot')
    await expect(mascot).toHaveCount(1)
    await expect(mascot).toHaveAttribute('width', '48')
    // The approved Iris artwork keeps its own vector shading and colours.
    await expect(mascot.locator('image')).toHaveAttribute('href', /hob-body-.*\.svg$/)
    await expect(mascot.locator('filter')).toHaveCount(0)
    await expect(sidebarMascot).toBeHidden()
    await expect(page.getByTestId('sidebar').getByRole('button', { name: 'Say hello to Hob' })).toBeHidden()
    await page.evaluate(() => document.fonts.ready)
    expect(await page.evaluate(() => document.fonts.check('16px "Hanken Grotesk"'))).toBe(true)
    if (process.env.HOB_SHOTS) await page.screenshot({ path: join(process.env.HOB_SHOTS, 'chat-new-light.png') })

    const eye = mascot.getByTestId('mascot-eyes').locator('rect').first()
    const box = (await mascot.boundingBox())!
    const right = await page.evaluate(() => innerWidth - 4)
    await page.mouse.move(right, box.y + box.height / 2)
    await expect(eye).toHaveAttribute('x', '18')
    await page.mouse.move(4, box.y + box.height / 2)
    await expect(eye).toHaveAttribute('x', '12')
    // Changing the OS preference also stops motion on an already mounted mascot.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(eye).toHaveAttribute('x', '15')
    await page.mouse.move(right, box.y + box.height / 2)
    await expect(eye).toHaveAttribute('x', '15')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await expect.poll(async () => {
      await page.mouse.move(right, box.y + box.height / 2)
      await page.mouse.move(4, box.y + box.height / 2)
      return eye.getAttribute('x')
    }).toBe('12')

    await page.getByTestId('composer-input').fill('__slow__')
    await page.getByTestId('composer-send').click()
    await expect(sidebarMascot).toHaveAttribute('width', '24')
    await expect(sidebarMascot).toHaveAttribute('data-expression', 'working')
    await expect(mascot).toHaveCount(1)
    await expect(page.getByTestId('composer-stop')).toBeHidden({ timeout: 20_000 })
    await expect(sidebarMascot).toHaveAttribute('data-expression', 'smile')
    await page.mouse.move(right, box.y)
    await expect(sidebarMascot.getByTestId('mascot-eyes').locator('rect').first()).toHaveAttribute('x', '15')
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
    // rare looks are brief: back to the smile within a second
    await page.clock.runFor(800)
    await expect(mascot).toHaveAttribute('data-expression', 'smile')
    await page.evaluate(() => { Math.random = () => .1 })
    await expect.poll(async () => { await page.clock.runFor(100); return mascot.getAttribute('data-expression') }, { intervals: [10], timeout: 10_000 }).toBe('neutral')
    await page.clock.runFor(900)
    await expect(mascot).toHaveAttribute('data-expression', 'smile')
    // most of the time it's only a blink
    await page.evaluate(() => { Math.random = () => .2 })
    await expect.poll(async () => { await page.clock.runFor(100); return mascot.getAttribute('data-expression') }, { intervals: [10], timeout: 10_000 }).toBe('blink')
    await page.evaluate(() => { Math.random = () => .9 })
    await expect.poll(async () => { await page.clock.runFor(100); return mascot.getAttribute('data-expression') }, { intervals: [10], timeout: 10_000 }).toBe('blink')
    await page.clock.runFor(4000)
    await expect(eye).not.toHaveAttribute('x', '12')

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(eye).toHaveAttribute('x', '15')
    await expect(mascot).toHaveAttribute('data-expression', 'smile')
    await page.mouse.move(1000, 20)
    await page.clock.runFor(8000)
    await expect(eye).toHaveAttribute('x', '15')
    await expect(mascot).toHaveAttribute('data-expression', 'smile')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await expect.poll(async () => {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.move(right, box.y + box.height / 2)
      return eye.getAttribute('x')
    }).toBe('18')
  } finally { await app.close() }
})

test('a happier Hob responds to clicks and keys, then forgives a flurry of clicks', async () => {
  const app = await electron.launch({ args: [join(import.meta.dirname, '../out/main/index.js')], env: {
    ...process.env, HOB_FAKE: '1', HOB_USER_DATA: mkdtempSync(join(tmpdir(), 'hob-reactions-')),
  } })
  try {
    const page = await app.firstWindow()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(page.getByTestId('setup-download')).toBeVisible()
    await page.clock.install()
    await page.clock.pauseAt(new Date(Date.now()))
    const mascot = page.getByTestId('mascot')
    const hello = page.getByRole('button', { name: 'Say hello to Hob' })
    await expect(mascot).toHaveAttribute('data-expression', 'smile')
    const original = await page.locator('.onboarding-mascot').boundingBox()
    await hello.click()
    await expect(mascot).toHaveAttribute('data-expression', 'content')
    await hello.click()
    await expect(mascot).toHaveAttribute('data-expression', 'wink')
    await hello.click()
    await expect(mascot).toHaveAttribute('data-expression', 'laugh')
    await expect(hello.getByRole('status')).toHaveText('Hob laughs.')
    for (let i = 0; i < 3; i++) await hello.click()
    await expect(mascot).toHaveAttribute('data-expression', 'skeptical')
    await page.clock.runFor(2000)
    await expect(mascot).toHaveAttribute('data-expression', 'smile')
    await hello.focus()
    await page.keyboard.press('Enter')
    await expect(mascot).toHaveAttribute('data-expression', 'content')
    await page.keyboard.press('Space')
    await expect(mascot).toHaveAttribute('data-expression', 'wink')
    await expect(hello).toBeFocused()
    await page.clock.runFor(10_000)
    await expect(mascot).toHaveAttribute('data-expression', 'smile')
    expect(await page.locator('.onboarding-mascot').boundingBox()).toEqual(original)
    // No automatic animation under reduced motion, including after an interaction.
    await expect(mascot.getByTestId('mascot-eyes').locator('rect').first()).toHaveAttribute('x', '15')
    await page.clock.resume()
    await page.getByTestId('setup-download').click()
    await expect(page.getByRole('heading', { name: 'What are we working on?' })).toBeVisible()
    await hello.click()
    await expect(page.locator('.chat-greeting').getByTestId('mascot')).toHaveAttribute('data-expression', 'content')
    await page.getByTestId('composer-input').fill('hello')
    await page.getByTestId('composer-send').click()
    await expect(page.getByTestId('message-assistant')).toBeVisible()
    await expect(page.getByTestId('status')).toHaveText('Ready')
    const sidebar = page.getByTestId('sidebar')
    const littleHob = sidebar.getByTestId('mascot')
    const littleHello = sidebar.getByRole('button', { name: 'Say hello to Hob' })
    await expect(littleHello).toBeVisible()
    await expect(hello).toHaveCount(1)
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
    const resting = await littleHob.boundingBox()
    // the corner Hob laughs at every click
    for (let i = 0; i < 6; i++) {
      await littleHello.click()
      await expect(littleHob).toHaveAttribute('data-expression', 'laugh')
    }
    await expect(littleHello.getByRole('status')).toHaveText('Hob laughs.')
    await page.clock.runFor(2000)
    await expect(littleHob).toHaveAttribute('data-expression', 'smile')
    await littleHello.focus()
    await page.keyboard.press('Enter')
    await expect(littleHob).toHaveAttribute('data-expression', 'laugh')
    await page.keyboard.press('Space')
    await expect(littleHob).toHaveAttribute('data-expression', 'laugh')
    await expect(littleHello).toBeFocused()
    await page.clock.runFor(10_000)
    await expect(littleHob).toHaveAttribute('data-expression', 'smile')
    await expect(littleHob.getByTestId('mascot-eyes').locator('rect').first()).toHaveAttribute('x', '15')
    expect(await littleHob.boundingBox()).toEqual(resting)

    // A hello can interrupt the working face without changing the actual task status.
    await page.clock.resume()
    await page.getByTestId('composer-input').fill('__slower__')
    await page.getByTestId('composer-send').click()
    await expect(littleHob).toHaveAttribute('data-expression', 'working')
    await littleHello.click()
    await expect(littleHob).toHaveAttribute('data-expression', 'laugh')
    await expect(page.getByTestId('status')).toHaveText('Working…')
    await expect(littleHob).toHaveAttribute('data-expression', 'working')
    await page.getByTestId('composer-stop').click()
    await expect(page.getByTestId('status')).toHaveText('Ready')
    await page.getByTestId('new-chat').click()
    await expect(littleHello).toBeHidden()
    await expect(page.getByRole('button', { name: 'Say hello to Hob' })).toHaveCount(1)
  } finally { await app.close() }
})

test('Hob in the corner shows what "Ready" shows, and laughs when clicked', async () => {
  const app = await electron.launch({ args: [join(import.meta.dirname, '../out/main/index.js')], env: {
    ...process.env, HOB_FAKE: '1', HOB_USER_DATA: mkdtempSync(join(tmpdir(), 'hob-corner-')),
  } })
  try {
    const page = await app.firstWindow()
    await page.getByTestId('setup-download').click()
    await expect(page.getByTestId('status')).toHaveText(/^Ready$/, { timeout: 20_000 })
    // the corner Hob shows once a chat is open (the new-chat screen has the big one)
    await page.getByTestId('composer-input').fill('hi')
    await page.getByTestId('composer-send').click()
    await expect(page.getByTestId('message-assistant').last()).toContainText('You said: hi')
    const corner = page.getByTestId('sidebar').getByTestId('mascot')
    await corner.hover()
    await expect(page.getByTestId('status-tooltip')).toBeVisible()
    await expect(page.getByTestId('status-tooltip')).toContainText('Runs on this computer')
    await corner.click()
    await expect(corner).toHaveAttribute('data-expression', 'laugh')
    // every click, not only the third
    await page.mouse.move(600, 300)
    await expect(corner).not.toHaveAttribute('data-expression', 'laugh', { timeout: 5_000 })
    await corner.click()
    await expect(corner).toHaveAttribute('data-expression', 'laugh')
  } finally {
    await app.close()
  }
})

