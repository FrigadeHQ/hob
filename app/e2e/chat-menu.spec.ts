import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const main = join(import.meta.dirname, '../out/main/index.js')

async function send(page: Page, text: string) {
  await page.getByTestId('composer-input').fill(text)
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('message-assistant').last()).toContainText(`You said: ${text}`)
}

test('the … beside a chat: pin, rename, save as Markdown, delete', async () => {
  const app = await electron.launch({ args: [main], env: { ...process.env, HOB_FAKE: '1', HOB_USER_DATA: mkdtempSync(join(tmpdir(), 'hob-e2e-')) } })
  const page = await app.firstWindow()
  await page.getByTestId('setup-download').click()
  await expect(page.getByTestId('status')).toHaveText(/^Ready$/, { timeout: 20_000 })
  await send(page, 'weekend plans')
  await page.getByTestId('new-chat').click()
  await send(page, 'groceries')
  const row = (name: string) => page.getByTestId('chat-row').filter({ hasText: name })
  const menu = async (name: string) => { await row(name).hover(); await row(name).getByTestId('chat-menu').click() }

  // pin: it moves to Pinned, above the rest; unpin puts it back
  await menu('weekend plans')
  await page.getByTestId('chat-pin').click()
  await expect(page.getByTestId('pinned').getByTestId('chat-item')).toHaveText(['Title for: weekend plans'])
  await expect(page.getByTestId('chat-item').first()).toHaveText('Title for: weekend plans')

  // rename: the name is selected, so typing replaces it; a blank name can't be saved
  await menu('weekend plans')
  await page.getByTestId('chat-rename').click()
  const input = page.getByTestId('rename-input')
  await expect(input).toBeFocused()
  await page.keyboard.type('Trip ideas')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('rename-dialog')).toHaveCount(0)
  await expect(page.getByTestId('pinned').getByTestId('chat-item')).toHaveText(['Trip ideas'])
  await menu('Trip ideas')
  await page.getByTestId('chat-rename').click()
  await input.fill('   ')
  await expect(page.getByTestId('rename-save')).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(row('Trip ideas')).toHaveCount(1)

  await menu('Trip ideas')
  await page.getByTestId('chat-pin').click()
  await expect(page.getByTestId('pinned')).toHaveCount(0)

  // save as Markdown: cancelling writes nothing
  const dir = mkdtempSync(join(tmpdir(), 'hob-md-'))
  const file = join(dir, 'trip.md')
  await app.evaluate(({ dialog }) => { dialog.showSaveDialog = (async () => ({ canceled: true, filePath: '' })) as never })
  await menu('Trip ideas')
  await page.getByTestId('chat-save').click()
  await app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = (async () => ({ canceled: false, filePath: p })) as never }, file)
  await menu('Trip ideas')
  await page.getByTestId('chat-save').click()
  await expect.poll(() => existsSync(file) && readFileSync(file, 'utf8')).toBe('# Trip ideas\n\n**You**\n\nweekend plans\n\n**Hob**\n\nYou said: weekend plans\n')

  // delete asks first
  await menu('Trip ideas')
  await page.getByTestId('chat-delete').click()
  await page.getByTestId('confirm-ok').click()
  await expect(row('Trip ideas')).toHaveCount(0)
  await expect(page.getByTestId('chat-item')).toHaveCount(1)
  await app.close()
})
