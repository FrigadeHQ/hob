import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const main = join(import.meta.dirname, '../out/main/index.js')
type Notice = { title: string; body: string }
const notices = (app: ElectronApplication) => app.evaluate(() => ((globalThis as { hobNotices?: Notice[] }).hobNotices ?? []).map(({ title, body }) => ({ title, body })))
// the person switched to another app
const away = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
// back in Hob: on Linux and Windows a hidden window pauses animation frames, and clicks wait for them
const back = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show())

test('a reply that finishes while Hob is in the background sends a notification, and clicking it opens that chat', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hob-home-'))
  mkdirSync(join(home, 'Pictures', 'Japan trip'), { recursive: true })
  const app = await electron.launch({ args: [main], env: { ...process.env, HOME: home, USERPROFILE: home, HOB_FAKE: '1', HOB_USER_DATA: mkdtempSync(join(tmpdir(), 'hob-e2e-')) } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('setup-download')).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('setup-download').click()
    await expect(page.getByTestId('status')).toHaveText(/^Ready$/, { timeout: 20_000 })

    await page.getByTestId('composer-input').fill('__slow__ what should I cook tonight')
    await page.getByTestId('composer-send').click()
    await away(app)
    await expect.poll(() => notices(app), { timeout: 20_000 }).toEqual([{ title: expect.any(String), body: 'Hob finished replying.' }])

    // somewhere else in the app, away again, then the notification
    await back(app)
    await page.getByTestId('new-chat').click()
    await away(app)
    await expect(page.getByText('__slow__ what should I cook tonight')).toHaveCount(0)
    await app.evaluate(() => (globalThis as unknown as { hobNotices: { onClick(): void }[] }).hobNotices[0].onClick())
    await expect(page.getByText('__slow__ what should I cook tonight')).toBeVisible()
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true)

    // waiting for an OK while away says so too
    await page.getByTestId('new-chat').click()
    await page.getByTestId('composer-input').fill('__tools__ [["list_files",{"path":"~/Pictures/Japan trip"}]]')
    await away(app)
    await page.getByTestId('composer-input').press('Enter')
    await expect.poll(async () => (await notices(app)).at(-1)?.body, { timeout: 20_000 }).toBe('Hob needs your OK to keep going.')
  } finally { await app.close() }
})
