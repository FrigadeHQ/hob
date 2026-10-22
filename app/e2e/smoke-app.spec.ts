import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The app with its real tools (Python, web search, the image model) and the stand-in model calling them, as on a
// user's computer. Downloads about 2 GB, so it runs only with HOB_SMOKE=1 (the Smoke workflow, on every system).
test.skip(process.env.HOB_SMOKE !== '1', 'set HOB_SMOKE=1')
test.setTimeout(45 * 60_000)

async function call(page: Page, tools: [string, unknown][]) {
  const before = await page.getByTestId('message-assistant').count()
  await page.getByTestId('composer-input').fill(`__tools__ ${JSON.stringify(tools)}`)
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('message-assistant')).toHaveCount(before + 1)
  await expect(page.getByTestId('composer-send')).toBeVisible({ timeout: 15 * 60_000 })
  return page.getByTestId('message-assistant').last().innerText()
}

test('the real tools work in the app', async () => {
  const app = await electron.launch({ args: [join(import.meta.dirname, '../out/main/index.js')], env: { ...process.env, HOB_FAKE: '1', HOB_REAL_TOOLS: '1', HOB_USER_DATA: mkdtempSync(join(tmpdir(), 'hob-smoke-')) } })
  try {
    const page = await app.firstWindow()
    await page.getByTestId('setup-download').click()
    // chat opens; the status may already show the image model downloading
    await expect(page.getByTestId('composer-input')).toBeVisible({ timeout: 60_000 })

    // Python, in its sandbox: sets itself up on first use, then makes a picture in the chat folder
    expect(await call(page, [['run_python', { code: 'from PIL import Image\nImage.new("RGB", (64, 64), (220, 20, 20)).save("red.png")\nprint(6 * 7)' }]])).toContain('42')

    // web search through SearXNG on this computer
    expect(await call(page, [['web_search', { query: 'Wikipedia' }]])).toMatch(/https?:\/\//)

    // the image model: downloads after the chat model, then answers about the picture
    await expect.poll(async () => (await page.evaluate(() => window.hob.vision.getState())).phase, { timeout: 30 * 60_000, intervals: [5000] }).toBe('ready')
    expect((await call(page, [['look_at_image', { path: 'red.png', question: 'What colour is this picture? One word.' }]])).toLowerCase()).toContain('red')
  } finally { await app.close() }
})
