import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const main = join(import.meta.dirname, '../out/main/index.js')
const pick = (app: ElectronApplication, paths: string[]) =>
  app.evaluate(({ dialog }, filePaths) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths })) as never }, paths)

test('projects: make one with a folder, chat in it, open its folder, edit it, remove it', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hob-home-'))
  const trip = join(home, 'Documents', 'Japan trip')
  mkdirSync(trip, { recursive: true })
  writeFileSync(join(trip, 'old.txt'), 'keep')
  const app = await electron.launch({ args: [main], env: { ...process.env, HOME: home, USERPROFILE: home, HOB_FAKE: '1', HOB_USER_DATA: mkdtempSync(join(tmpdir(), 'hob-e2e-')) } })
  const page = await app.firstWindow()
  await page.getByTestId('setup-download').click()
  await expect(page.getByTestId('status')).toHaveText(/^Ready$/, { timeout: 20_000 })

  // create: the name comes from the first folder; the whole home folder is refused with a reason
  await page.getByTestId('new-project').click()
  const dialog = page.getByTestId('project-dialog')
  await expect(dialog).toContainText('Create project')
  await pick(app, [home])
  await page.getByTestId('project-add-folder').click()
  await expect(page.getByTestId('project-folder-problem')).toContainText('inside your home folder')
  await expect(page.getByTestId('project-folder')).toHaveCount(0)
  await pick(app, [trip])
  await page.getByTestId('project-add-folder').click()
  await expect(page.getByTestId('project-folder')).toContainText('Japan trip')
  // one folder: no need to say new files go there
  await expect(page.getByTestId('project-folder')).not.toContainText('New files go here')
  await expect(page.getByTestId('project-name')).toHaveValue('Japan trip')
  await page.getByTestId('project-instructions').fill('Name photos by date')
  await page.getByTestId('project-save').click()
  await expect(dialog).toHaveCount(0)

  // a new chat in it: the sidebar, the chip and the heading say so
  await expect(page.getByTestId('project-item')).toContainText('Japan trip')
  await expect(page.getByTestId('project-chip')).toContainText('Japan trip')
  await expect(page.getByRole('heading')).toContainText('What should we do in Japan trip?')

  // new files go into the project folder without a card; Undo takes them away
  await page.getByTestId('composer-input').fill(`__tools__ [["write_file",{"path":${JSON.stringify(join(trip, 'notes.txt'))},"content":"hi"}]]`)
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('undo')).toBeVisible()
  await expect(page.getByTestId('approval')).toHaveCount(0)
  expect(readFileSync(join(trip, 'notes.txt'), 'utf8')).toBe('hi')
  // the chat sits under the project, and its chip can't change any more
  await expect(page.getByTestId('project-item').getByTestId('chat-item')).toHaveCount(1)
  await expect(page.getByTestId('project-chip')).not.toHaveRole('button')
  await page.getByTestId('undo').click()
  await expect.poll(() => existsSync(join(trip, 'notes.txt'))).toBe(false)

  // "open folder": opens the project folder in the file manager
  await app.evaluate(({ shell }) => { (globalThis as Record<string, unknown>).opened = []; shell.openPath = (async (p: string) => { ((globalThis as Record<string, unknown>).opened as string[]).push(p); return '' }) as never })
  await page.getByTestId('composer-input').fill('__tools__ [["open_folder",{}]]')
  await page.getByTestId('composer-send').click()
  await expect.poll(() => app.evaluate(() => (globalThis as Record<string, unknown>).opened)).toEqual([trip])

  // a chat outside the project: no chip menu choice made, so it's under the chat list
  await page.getByTestId('new-chat').click()
  await expect(page.getByTestId('project-chip')).toContainText('No project')
  await page.getByTestId('composer-input').fill('hello')
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('message-assistant').last()).toContainText('You said: hello')
  await expect(page.getByTestId('project-item').getByTestId('chat-item')).toHaveCount(1)

  // the + next to Today starts a new chat
  await page.getByTestId('chat-item').first().click()
  await page.getByTestId('new-chat-inline').click()
  await expect(page.getByTestId('message-assistant')).toHaveCount(0)
  await expect(page.getByTestId('project-chip')).toContainText('No project')

  // the chip picks a project for a new chat
  await page.getByTestId('new-chat').click()
  await page.getByTestId('project-chip').click()
  await page.getByTestId('project-option').filter({ hasText: 'Japan trip' }).click()
  await expect(page.getByRole('heading')).toContainText('Japan trip')

  // edit: rename; remove: its chats move to the chat list, files stay
  await page.getByTestId('project-item').hover()
  await page.getByTestId('project-edit').click()
  await expect(page.getByTestId('project-instructions')).toHaveValue('Name photos by date')
  await page.getByTestId('project-name').fill('Japan 2026')
  await page.getByTestId('project-save').click()
  await expect(page.getByTestId('project-item')).toContainText('Japan 2026')
  await page.getByTestId('project-item').hover()
  await page.getByTestId('project-edit').click()
  await page.getByTestId('project-remove').click()
  await expect(page.getByTestId('confirm')).toContainText('Your folders and files stay as they are')
  await page.getByTestId('confirm-ok').click()
  await expect(page.getByTestId('project-item')).toHaveCount(0)
  await expect(page.getByTestId('chat-item')).toHaveCount(2)
  expect(existsSync(join(trip, 'old.txt'))).toBe(true)
  await app.close()
})
