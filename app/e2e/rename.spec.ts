import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const main = join(import.meta.dirname, '../out/main/index.js')

async function send(page: Page, text: string) {
  await page.getByTestId('composer-input').fill(text)
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('message-assistant').last()).toContainText(`You said: ${text}`)
}

test('rename a chat from the sidebar; Esc keeps the old name', async () => {
  const app = await electron.launch({ args: [main], env: { ...process.env, HOB_FAKE: '1', HOB_USER_DATA: mkdtempSync(join(tmpdir(), 'hob-e2e-')) } })
  const page = await app.firstWindow()
  await page.getByTestId('setup-download').click()
  await expect(page.getByTestId('status')).toHaveText(/^Ready$/, { timeout: 20_000 })

  await send(page, 'weekend plans')
  const row = page.getByTestId('chat-row').first()
  await row.hover()
  await row.getByTestId('rename-chat').click()
  const input = page.getByTestId('rename-chat-input')
  await expect(input).toBeFocused()
  await input.fill('Trip ideas')
  await input.press('Enter')
  await expect(page.getByTestId('chat-item')).toHaveText('Trip ideas')

  // Esc leaves the name as it is
  await row.hover()
  await row.getByTestId('rename-chat').click()
  await expect(input).toHaveValue('Trip ideas')
  await input.fill('Scratch this')
  await input.press('Escape')
  await expect(page.getByTestId('rename-chat-input')).toHaveCount(0)
  await expect(page.getByTestId('chat-item')).toHaveText('Trip ideas')

  // a blank name is ignored
  await row.hover()
  await row.getByTestId('rename-chat').click()
  await input.fill('   ')
  await input.press('Enter')
  await expect(page.getByTestId('chat-item')).toHaveText('Trip ideas')

  // the new name sticks after leaving and coming back
  await page.getByTestId('new-chat').click()
  await expect(page.getByTestId('message-assistant')).toHaveCount(0)
  await page.getByTestId('chat-item').click()
  await expect(page.getByTestId('chat-item')).toHaveText('Trip ideas')
  await expect(page.getByTestId('message-assistant')).toContainText('weekend plans')
  await app.close()
})
