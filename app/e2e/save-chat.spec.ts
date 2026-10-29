import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const main = join(import.meta.dirname, '../out/main/index.js')
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

async function send(page: Page, text: string) {
  await page.getByTestId('composer-input').fill(text)
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('message-assistant').last()).toContainText(`You said: ${text}`)
}

test('save a chat as a Markdown file from the sidebar, or with the shortcut', async () => {
  const app = await electron.launch({ args: [main], env: { ...process.env, HOB_FAKE: '1', HOB_USER_DATA: mkdtempSync(join(tmpdir(), 'hob-e2e-')) } })
  const page = await app.firstWindow()
  await page.getByTestId('setup-download').click()
  await expect(page.getByTestId('status')).toHaveText(/^Ready$/, { timeout: 20_000 })

  await send(page, 'weekend plans')
  await expect(page.getByTestId('chat-item').first()).toContainText('weekend plans')
  const row = page.getByTestId('chat-row').first()
  const dir = mkdtempSync(join(tmpdir(), 'hob-md-'))
  const canceled = join(dir, 'canceled.md')
  const fromSidebar = join(dir, 'sidebar.md')
  const fromKeys = join(dir, 'keys.md')

  await app.evaluate(({ dialog }, p) => {
    const g = globalThis as { __hobSaves?: number }
    g.__hobSaves = 0
    dialog.showSaveDialog = (async () => {
      g.__hobSaves = (g.__hobSaves ?? 0) + 1
      return { canceled: true, filePath: p }
    }) as never
  }, canceled)
  await row.hover()
  await row.getByTestId('save-chat').click()
  await expect.poll(() => app.evaluate(() => (globalThis as { __hobSaves?: number }).__hobSaves)).toBe(1)
  expect(existsSync(canceled)).toBe(false)

  await app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = (async () => ({ canceled: false, filePath: p })) as never }, fromSidebar)
  await row.hover()
  await row.getByTestId('save-chat').click()
  await expect.poll(() => { try { return readFileSync(fromSidebar, 'utf8') } catch { return '' } }).toBe(
    '# Title for: weekend plans\n\nYou\n\nweekend plans\n\nHob\n\nYou said: weekend plans\n',
  )

  await app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = (async () => ({ canceled: false, filePath: p })) as never }, fromKeys)
  await page.keyboard.press(`${mod}+s`)
  await expect.poll(() => { try { return readFileSync(fromKeys, 'utf8') } catch { return '' } }).toBe(
    '# Title for: weekend plans\n\nYou\n\nweekend plans\n\nHob\n\nYou said: weekend plans\n',
  )
  await app.close()
})
