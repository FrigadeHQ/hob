import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const main = join(import.meta.dirname, '../out/main/index.js')

/** a pretend home folder: project folders must be inside it (temp folders count as system folders) */
async function launch(userData = mkdtempSync(join(tmpdir(), 'garth-e2e-')), home = mkdtempSync(join(tmpdir(), 'garth-home-'))) {
  const app = await electron.launch({ args: [main], env: { ...process.env, HOME: home, USERPROFILE: home, GARTH_FAKE: '1', GARTH_USER_DATA: userData } })
  const page = await app.firstWindow()
  return { app, page, userData, home }
}
/** first launch shows onboarding; later launches go straight to chat */
async function ready(page: Page) {
  await expect(page.getByTestId('setup-download').or(page.getByTestId('composer-input'))).toBeVisible({ timeout: 20_000 })
  if (await page.getByTestId('setup-download').isVisible()) await page.getByTestId('setup-download').click()
  await expect(page.getByTestId('status')).toHaveText(/^Ready$/, { timeout: 20_000 })
}
/** finished replies collapse their steps into "Worked for …"; open the latest one */
const expandWork = (page: Page) => page.getByTestId('worklog-toggle').last().click()
const stubOpenDialog = (app: ElectronApplication, paths: string[]) =>
  app.evaluate(({ dialog }, filePaths) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths })) as never }, paths)

test('attach a file, the agent works on it, the chat is saved', async () => {
  const src = mkdtempSync(join(tmpdir(), 'garth-src-'))
  writeFileSync(join(src, 'sales.csv'), 'name,sales\nA,10\nB,30\n')
  const { app, page, userData } = await launch()
  await ready(page)

  await stubOpenDialog(app, [join(src, 'sales.csv')])
  await page.getByTestId('attach').click()
  await expect(page.getByTestId('attachment-chip')).toContainText('sales.csv')

  await page.getByTestId('composer-input').fill('__tools__ [["read_file",{"path":"sales.csv"}],["write_file",{"path":"summary.txt","content":"total 40"}]]')
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('file-card').filter({ hasText: 'summary.txt' })).toBeVisible()
  await expandWork(page)
  await expect(page.getByTestId('step').filter({ hasText: 'Read sales.csv' })).toHaveAttribute('data-status', 'done')
  await expect(page.getByTestId('file-card').filter({ hasText: 'summary.txt' })).toBeVisible()
  await expect(page.getByTestId('chat-item').first()).toContainText('__tools__')
  expect(existsSync(join(src, 'summary.txt'))).toBe(false) // originals' folder untouched
  await app.close()

  // relaunch: chat is in the sidebar and opens with its steps
  const again = await launch(userData)
  await ready(again.page)
  await expect(again.page.getByTestId('chat-item')).toHaveCount(1)
  await again.page.getByTestId('chat-item').first().click()
  await expandWork(again.page)
  await expect(again.page.getByTestId('step').filter({ hasText: 'Wrote summary.txt' })).toBeVisible()
  await again.app.close()
})

test('changes in a project folder ask first and can be undone', async () => {
  const { app, page, home } = await launch()
  const folder = join(home, 'Documents', 'Letters')
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'old.txt'), 'keep me')
  await ready(page)
  await stubOpenDialog(app, [folder])
  await page.getByTestId('new-project').click()
  await page.getByTestId('project-add-folder').click()
  await page.getByTestId('project-save').click()
  await expect(page.getByTestId('project-item')).toHaveCount(1)

  await page.getByTestId('composer-input').fill(`__tools__ [["move_file",{"from":${JSON.stringify(join(folder, 'old.txt'))},"to":${JSON.stringify(join(folder, 'sorted', 'old.txt'))}}]]`)
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('approval')).toContainText('Move old.txt to sorted/old.txt?')
  await page.getByTestId('approval-allow').click()
  await expect(page.getByTestId('undo')).toBeVisible()
  await expandWork(page)
  await expect(page.getByTestId('step').first()).toHaveAttribute('data-status', 'done')
  expect(existsSync(join(folder, 'sorted', 'old.txt'))).toBe(true)

  await page.getByTestId('undo').click()
  await expect(page.getByTestId('undone')).toBeVisible()
  expect(existsSync(join(folder, 'old.txt'))).toBe(true)
  await app.close()
})

test('settings: web access is on by default, turning it off persists, current model is shown', async () => {
  const { app, page, userData } = await launch()
  await ready(page)
  await page.getByTestId('open-settings').click()
  await page.getByTestId('settings-nav-model').click()
  await expect(page.getByTestId('settings-current-model')).toContainText('Gemma 4')
  await page.getByTestId('settings-nav-privacy').click()
  await expect(page.getByTestId('web-toggle')).toHaveAttribute('aria-checked', 'true') // on by default
  await page.getByTestId('web-toggle').click()
  await expect(page.getByTestId('web-toggle')).toHaveAttribute('aria-checked', 'false')
  await app.close()
  const again = await launch(userData)
  await ready(again.page)
  await again.page.getByTestId('open-settings').click()
  await again.page.getByTestId('settings-nav-privacy').click()
  await expect(again.page.getByTestId('web-toggle')).toHaveAttribute('aria-checked', 'false')
  await again.app.close()
})

test('markdown tables in replies render as tables', async () => {
  const { app, page } = await launch()
  await ready(page)
  await page.getByTestId('composer-input').fill('__table__')
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('message-assistant').last().locator('table td').first()).toHaveText('North')
  await app.close()
})

test('replies never load images from the internet', async () => {
  const { app, page } = await launch()
  await ready(page)
  await page.getByTestId('composer-input').fill('__img__')
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('message-assistant').last()).toContainText('done')
  await expect(page.getByTestId('message-assistant').last().locator('img')).toHaveCount(0)
  await app.close()
})

test('opening Settings mid-task does not stop it', async () => {
  const { app, page } = await launch()
  await ready(page)
  await page.getByTestId('composer-input').fill('__slow__')
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('message-assistant').last()).toContainText('one')
  await page.getByTestId('open-settings').click()
  await expect(page.getByTestId('settings')).toBeVisible()
  await page.getByTestId('settings-close').click()
  await expect(page.getByTestId('message-assistant').last()).toContainText('eight', { timeout: 10_000 })
  await expect(page.getByTestId('message-assistant').last()).not.toContainText('Stopped')
  await app.close()
})

test('web search is on by default and runs without asking', async () => {
  const { app, page } = await launch()
  await ready(page)
  await page.getByTestId('composer-input').fill('__tools__ [["web_search",{"query":"lisbon weather"}]]')
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('message-assistant').last()).toContainText('Lisbon')
  await expandWork(page)
  await expect(page.getByTestId('step').filter({ hasText: 'Searched the web' })).toHaveAttribute('data-status', 'done')
  await expect(page.getByTestId('approval')).toHaveCount(0)
  await expect(page.getByTestId('message-assistant').last()).toContainText('Lisbon')
  await app.close()
})

test('dictation fills the message box', async () => {
  const { app, page } = await launch()
  await ready(page)
  await page.getByTestId('dictate').click()
  // recording: a live waveform, a clear Stop button, the box says it's listening
  await expect(page.getByTestId('dictation-wave')).toBeVisible()
  await expect(page.getByTestId('dictate')).toHaveAttribute('aria-label', 'Stop and add the text (Enter)')
  await expect(page.getByTestId('composer-input')).toHaveAttribute('placeholder', 'Listening…')
  // nothing else moves: Send stays where it is
  await expect(page.getByTestId('composer-send')).toBeVisible()
  await page.getByTestId('dictate').click()
  await expect(page.getByTestId('composer-input')).toHaveValue(/Hello from dictation/)
  await expect(page.getByTestId('dictation-wave')).toHaveCount(0)
  await expect(page.getByTestId('dictate')).toHaveAttribute('aria-label', 'Dictate')
  // Esc throws a recording away; Enter stops and adds the text
  await page.getByTestId('composer-input').fill('')
  await page.getByTestId('dictate').click()
  await expect(page.getByTestId('dictation-wave')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('dictation-wave')).toHaveCount(0)
  await expect(page.getByTestId('composer-input')).toHaveValue('')
  await page.getByTestId('dictate').click()
  await expect(page.getByTestId('dictation-wave')).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('composer-input')).toHaveValue(/Hello from dictation/)
  // Enter added the text; it didn't send it
  await expect(page.getByTestId('composer-send')).toBeEnabled()
  await app.close()
})

test('the work log stays live while the model talks between steps; the chat is titled right away', async () => {
  const src = mkdtempSync(join(tmpdir(), 'garth-src-'))
  writeFileSync(join(src, 'notes.txt'), 'hi')
  const { app, page } = await launch()
  await ready(page)
  await stubOpenDialog(app, [join(src, 'notes.txt')])
  await page.getByTestId('attach').click() // creates the chat before the first message
  await expect(page.getByTestId('chat-item').first()).toHaveText('New chat')
  await page.getByTestId('composer-input').fill('__narrate__')
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('message-assistant').last()).toContainText('Let me look first')
  await expect(page.getByTestId('chat-item').first()).toHaveText('__narrate__')
  await expect(page.getByTestId('step')).toHaveCount(1) // a step after the text: still working
  await expect(page.getByTestId('worklog-toggle')).toHaveCount(0) // not "Worked for …" yet
  await expect(page.getByTestId('composer-stop')).toBeVisible()
  await expect(page.getByTestId('message-assistant').last()).toContainText('All done')
  await expect(page.getByTestId('worklog-toggle')).toBeVisible()
  await app.close()
})

test('the microphone is available to the page; the camera is not', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'garth-e2e-'))
  const app = await electron.launch({ args: [main, '--use-fake-device-for-media-stream'], env: { ...process.env, GARTH_FAKE: '1', GARTH_USER_DATA: userData } })
  const page = await app.firstWindow()
  const r = await page.evaluate(async () => {
    const tryGet = async (c: MediaStreamConstraints) => { try { (await navigator.mediaDevices.getUserMedia(c)).getTracks().forEach((t) => t.stop()); return 'ok' } catch (e) { return (e as Error).name } }
    return { mic: await tryGet({ audio: { echoCancellation: true, noiseSuppression: true } }), camera: await tryGet({ video: true }) }
  })
  expect(r.mic).toBe('ok')
  expect(r.camera).not.toBe('ok')
  await app.close()
})

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

test('Garth looks at an attached photo and answers from what it sees', async () => {
  const src = mkdtempSync(join(tmpdir(), 'garth-src-'))
  writeFileSync(join(src, 'receipt.png'), PNG)
  const { app, page } = await launch()
  await ready(page)
  await stubOpenDialog(app, [join(src, 'receipt.png')])
  await page.getByTestId('attach').click()
  await page.getByTestId('composer-input').fill('__tools__ [["look_at_image",{"path":"receipt.png","question":"What is the total?"}]]')
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('message-assistant').last()).toContainText('Total: $23.40')
  await expandWork(page)
  await expect(page.getByTestId('step').first()).toContainText('Looked at receipt.png')
  // Settings says image support is ready
  await page.getByTestId('open-settings').click()
  await page.getByTestId('settings-nav-model').click()
  await expect(page.getByTestId('settings-vision')).toContainText('Ready')
  await app.close()
})

test('a pasted screenshot becomes an attachment', async () => {
  const { app, page } = await launch()
  await ready(page)
  await page.getByTestId('composer-input').focus()
  await page.evaluate((bytes) => {
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array(bytes)], 'image.png', { type: 'image/png' }))
    document.querySelector('[data-testid=composer-input]')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, [...PNG])
  await expect(page.getByTestId('attachment-chip')).toContainText('Pasted image')
  await app.close()
})

test('clicking an attached photo or PDF previews it inside Garth', async () => {
  const src = mkdtempSync(join(tmpdir(), 'garth-src-'))
  writeFileSync(join(src, 'receipt.png'), PNG)
  const { copyFileSync } = await import('node:fs')
  copyFileSync(join(import.meta.dirname, '../test/fixtures/form-fields.pdf'), join(src, 'form.pdf'))
  const { app, page } = await launch()
  await ready(page)
  await stubOpenDialog(app, [join(src, 'receipt.png'), join(src, 'form.pdf')])
  await page.getByTestId('attach').click()
  // small previews right in the message box: the photo itself, and the PDF's first page
  await expect(page.getByTestId('attachment-thumb-image')).toHaveAttribute('data-smooth', 'yes')
  await expect(page.getByTestId('attachment-thumb-pdf').locator('canvas')).toBeVisible()
  await expect(page.getByTestId('attachment-chip').nth(1)).toContainText('form.pdf')
  await page.getByTestId('attachment-open').first().click()
  await expect(page.getByTestId('preview-image')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('preview')).toHaveCount(0)
  await page.getByTestId('attachment-open').nth(1).click()
  await expect(page.locator('[data-testid=pdf-page]').first()).toBeVisible()
  await page.getByTestId('preview-close').click()
  await expect(page.getByTestId('preview')).toHaveCount(0)
  await app.close()
})

test('the mic menu lists microphones and keeps the dictation language', async () => {
  const { app, page } = await launch()
  await ready(page)
  await page.getByTestId('mic-menu').click()
  await expect(page.getByTestId('mic-options')).toContainText('Dictation settings')
  await expect(page.getByTestId('mic-option').first()).toBeVisible()
  await page.getByTestId('dictation-language').click()
  await page.getByTestId('language-option').filter({ hasText: 'Danish' }).click()
  await expect(page.getByTestId('dictation-language')).toContainText('Danish')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('mic-options')).toHaveCount(0)
  await page.getByTestId('mic-menu').click()
  await expect(page.getByTestId('dictation-language')).toContainText('Danish')
  await app.close()
})

test('Mac: "Connect my email and calendar" asks for access once, then Garth reads the calendar and drafts email', async () => {
  test.skip(process.platform !== 'darwin', 'Calendar & Mail is Mac only')
  const { app, page } = await launch()
  await ready(page)
  const idea = page.getByTestId('suggestion').filter({ hasText: 'Connect my email and calendar' })
  await expect(idea).toBeVisible()
  await idea.click()
  await expect(page.getByTestId('connect-apps')).toContainText('Calendar and Mail apps on this Mac')
  await page.getByTestId('connect-apps-allow').click()
  await expect(page.getByTestId('connect-apps')).toContainText('Connected')
  await page.getByTestId('connect-apps-try').click()
  await expect(page.getByTestId('composer-send')).toBeVisible()
  // done: the idea is gone from the home screen
  await page.getByTestId('new-chat').click()
  await expect(page.getByTestId('suggestion').filter({ hasText: 'Connect my email' })).toHaveCount(0)
  await page.getByTestId('composer-input').fill('__tools__ [["calendar_events",{}],["mail_search",{"query":"flight"}]]')
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('message-assistant').last()).toContainText('Your flight to Lisbon')
  await page.getByTestId('composer-input').fill('__tools__ [["calendar_add_event",{"title":"Lunch with Sam","start":"2026-10-23T12:00"}]]')
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('approval')).toContainText('Add “Lunch with Sam” to your calendar')
  await page.getByTestId('approval-allow').click()
  await expect(page.getByTestId('message-assistant').last()).toContainText('Added “Lunch with Sam” to the Home calendar')
  await app.close()
})

test('Markdown streaming in never shows its ** or ` marks', async () => {
  const { app, page } = await launch()
  await ready(page)
  await page.getByTestId('composer-input').fill('__markdown__')
  await page.getByTestId('composer-send').click()
  const reply = page.getByTestId('message-assistant')
  const seen: string[] = []
  while (await page.getByTestId('composer-stop').isVisible().catch(() => false)) {
    seen.push(await reply.innerText().catch(() => ''))
    await page.waitForTimeout(60)
  }
  expect(seen.length).toBeGreaterThan(5)
  expect(seen.filter((t) => /[*`]/.test(t))).toEqual([])
  await expect(reply.locator('strong')).toHaveText('Important')
  await expect(reply.locator('em')).toHaveText('quite')
  await expect(reply.locator('code')).toHaveText('code')
  await app.close()
})
