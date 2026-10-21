import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const main = join(import.meta.dirname, '../out/main/index.js')
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

async function send(page: Page, text: string) {
  await page.getByTestId('composer-input').fill(text)
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('message-assistant').last()).toContainText(`You said: ${text}`)
}

test('search chats from the top bar or ⌘K, run quick actions, go back and forward', async () => {
  const app = await electron.launch({ args: [main], env: { ...process.env, HOB_FAKE: '1', HOB_USER_DATA: mkdtempSync(join(tmpdir(), 'hob-e2e-')) } })
  const page = await app.firstWindow()
  await page.getByTestId('setup-download').click()
  await expect(page.getByTestId('status')).toHaveText(/^Ready$/, { timeout: 20_000 })

  await send(page, 'shipping wine to canada')
  await page.getByTestId('new-chat').click()
  await send(page, 'best hikes near lisbon with a waterfall')
  await expect(page.getByTestId('chat-item')).toHaveCount(2)

  // ⌘K: recent chats and quick actions before typing
  await page.keyboard.press(`${mod}+k`)
  const bar = page.getByTestId('command-bar')
  await expect(bar).toBeVisible()
  await expect(bar).toContainText('Recent chats')
  await expect(bar).toContainText('Quick actions')
  // finds a chat by something said in it, with the words around it
  // typed into the box itself: on slow machines the keys can arrive before it has focus
  await bar.getByRole('textbox').fill('waterfall')
  await expect(bar.getByTestId('command-item').first()).toContainText('waterfall')
  await page.keyboard.press('Escape')
  await expect(bar).toBeHidden()

  // the search button opens it too; Enter opens the first chat found
  await page.getByTestId('open-search').click()
  await bar.getByRole('textbox').fill('wine')
  await expect(bar.getByTestId('command-item').first()).toContainText(/wine/i)
  await page.keyboard.press('Enter')
  await expect(bar).toBeHidden()
  await expect(page.getByTestId('message-assistant').first()).toContainText('shipping wine to canada')

  // quick action by keyboard
  await page.keyboard.press(`${mod}+k`)
  await bar.getByRole('textbox').fill('plugins')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('settings').getByRole('heading', { name: 'Skills' })).toBeVisible()
  await page.getByTestId('settings-close').click()

  // back: the lisbon chat; forward again
  await expect(page.getByTestId('message-assistant').first()).toContainText('shipping wine to canada')
  await page.getByTestId('go-back').click()
  await expect(page.getByTestId('message-assistant').first()).toContainText('lisbon')
  await expect(page.getByTestId('go-forward')).toBeEnabled()
  await page.keyboard.press(`${mod}+]`)
  await expect(page.getByTestId('message-assistant').first()).toContainText('shipping wine to canada')

  // ⌘N starts a new chat
  await page.keyboard.press(`${mod}+n`)
  await expect(page.getByTestId('message-assistant')).toHaveCount(0)
  await expect(page.getByTestId('go-forward')).toBeDisabled()
  await app.close()
})

test('Settings → Danger zone deletes every chat', async () => {
  const app = await electron.launch({ args: [main], env: { ...process.env, HOB_FAKE: '1', HOB_USER_DATA: mkdtempSync(join(tmpdir(), 'hob-e2e-')) } })
  const page = await app.firstWindow()
  await page.getByTestId('setup-download').click()
  await expect(page.getByTestId('status')).toHaveText(/^Ready$/, { timeout: 20_000 })
  await send(page, 'first chat')
  await page.getByTestId('new-chat').click()
  await send(page, 'second chat')
  await expect(page.getByTestId('chat-item')).toHaveCount(2)

  await page.getByTestId('open-settings').click()
  await page.getByTestId('settings-nav-files').click()
  await expect(page.getByTestId('files-dir')).not.toBeEmpty()
  const filesDir = (await page.getByTestId('files-dir').textContent())!
  const before = readdirSync(filesDir).length
  // asks first; Cancel keeps everything
  await page.getByTestId('delete-all-chats').click()
  await expect(page.getByTestId('confirm-delete-all')).toContainText('Delete all 2 chats?')
  await expect(page.getByTestId('confirm-delete-all')).toContainText('can’t be undone')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByTestId('chat-item')).toHaveCount(2)
  await page.getByTestId('delete-all-chats').click()
  await page.getByTestId('confirm-delete-all-yes').click()
  await expect(page.getByTestId('chat-item')).toHaveCount(0)
  // the files the chats made are still there
  expect(before).toBeGreaterThanOrEqual(2)
  expect(readdirSync(filesDir).length).toBe(before)
  // nothing left to go back to; a new chat is ready
  await page.getByTestId('settings-close').click()
  await expect(page.getByTestId('go-back')).toBeDisabled()
  await page.getByTestId('new-chat').click()
  await expect(page.getByTestId('message-assistant')).toHaveCount(0)
  await expect(page.getByTestId('composer-input')).toBeVisible()
  await app.close()
})

test('the sidebar can be dragged wider or narrower, is remembered, and double-click resets it', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'hob-e2e-'))
  const launch = () => electron.launch({ args: [main], env: { ...process.env, HOB_FAKE: '1', HOB_USER_DATA: userData } })
  let app = await launch()
  let page = await app.firstWindow()
  await page.getByTestId('setup-download').click()
  await expect(page.getByTestId('status')).toHaveText(/^Ready$/, { timeout: 20_000 })
  const sidebar = page.getByTestId('sidebar')
  const width = async () => Math.round((await sidebar.boundingBox())!.width)
  // the app fades in after setup; measure once it has settled
  await expect.poll(width).toBe(256)

  const handle = (await page.getByTestId('sidebar-resize').boundingBox())!
  const y = handle.y + 300
  await page.mouse.move(handle.x + 4, y)
  await page.mouse.down()
  await page.mouse.move(handle.x + 84, y, { steps: 5 })
  await page.mouse.up()
  expect(await width()).toBe(336)
  // can't go past the limits
  await page.mouse.move(handle.x + 84, y); await page.mouse.down(); await page.mouse.move(handle.x + 600, y, { steps: 5 }); await page.mouse.up()
  expect(await width()).toBe(420)

  await app.close()
  app = await launch()
  page = await app.firstWindow()
  await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 20_000 })
  const after = async () => Math.round((await page.getByTestId('sidebar').boundingBox())!.width)
  await expect.poll(after).toBe(420)
  await page.getByTestId('sidebar-resize').dblclick()
  await expect.poll(after).toBe(256)
  await app.close()
})

test('home ideas: two work on a file — they ask for one, then send it with the request', async () => {
  const src = mkdtempSync(join(tmpdir(), 'hob-src-'))
  writeFileSync(join(src, 'letter.txt'), 'Dear Sam, thank you for you’re help.')
  const app = await electron.launch({ args: [main], env: { ...process.env, HOB_FAKE: '1', HOB_USER_DATA: mkdtempSync(join(tmpdir(), 'hob-e2e-')) } })
  const page = await app.firstWindow()
  await page.getByTestId('setup-download').click()
  await expect(page.getByTestId('status')).toHaveText(/^Ready$/, { timeout: 20_000 })
  await expect(page.locator('[data-testid="suggestion"][data-file="true"]')).toHaveCount(2)
  // until email and calendar are connected, that idea takes one of the four
  await expect(page.locator('[data-testid="suggestion"][data-connect="true"]')).toHaveCount(1)
  await expect(page.locator('[data-testid="suggestion"][data-file="false"][data-connect="false"]')).toHaveCount(1)

  // cancelling the file picker does nothing
  await app.evaluate(({ dialog }) => { dialog.showOpenDialog = (async () => ({ canceled: true, filePaths: [] })) as never })
  await page.locator('[data-testid="suggestion"][data-file="true"]').first().click()
  await expect(page.getByTestId('message-assistant')).toHaveCount(0)

  await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as never }, join(src, 'letter.txt'))
  await page.locator('[data-testid="suggestion"][data-file="true"]').first().click()
  await expect(page.getByTestId('message-assistant').last()).toContainText('You said:')
  await expect(page.getByText('letter.txt').first()).toBeVisible()
  await app.close()
})

test('hiding the sidebar slides it away, and it comes back', async () => {
  const app = await electron.launch({ args: [main], env: { ...process.env, HOB_FAKE: '1', HOB_USER_DATA: mkdtempSync(join(tmpdir(), 'hob-e2e-')) } })
  const page = await app.firstWindow()
  await page.getByTestId('setup-download').click()
  await expect(page.getByTestId('status')).toHaveText(/^Ready$/, { timeout: 20_000 })
  const slot = page.getByTestId('sidebar-slot')
  const w = async () => Math.round((await slot.boundingBox())?.width ?? 0)
  await expect.poll(w).toBe(256)
  await page.getByTestId('toggle-sidebar').click()
  await expect(slot).toHaveAttribute('aria-hidden', 'true')
  await expect.poll(w).toBe(0)
  await page.getByTestId('toggle-sidebar').click()
  await expect.poll(w).toBe(256)
  await expect(page.getByTestId('new-chat')).toBeVisible()
  await app.close()
})
