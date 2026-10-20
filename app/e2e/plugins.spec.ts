import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const main = join(import.meta.dirname, '../out/main/index.js')

async function launch() {
  const app = await electron.launch({ args: [main], env: { ...process.env, HOB_FAKE: '1', HOB_USER_DATA: mkdtempSync(join(tmpdir(), 'hob-e2e-')) } })
  const page = await app.firstWindow()
  await page.getByTestId('setup-download').click()
  await expect(page.getByTestId('status')).toHaveText(/^Ready$/, { timeout: 20_000 })
  return { app, page }
}

test('built-in plugins are listed and can be turned off; Web search is the Web access switch', async () => {
  const { app, page } = await launch()
  await page.getByTestId('open-plugins').click()
  for (const id of ['web', 'weather', 'code', 'trip-planner', 'study-buddy', 'money']) await expect(page.locator(`[data-testid=plugin][data-id=${id}]`)).toBeVisible()
  const web = page.locator('[data-testid=plugin][data-id=web]')
  await web.getByTestId('plugin-toggle').click()
  await expect(web.getByTestId('plugin-toggle')).toHaveAttribute('aria-checked', 'false')
  await page.getByTestId('open-settings').click()
  await expect(page.getByTestId('web-toggle')).toHaveAttribute('aria-checked', 'false')
  await app.close()
})

test('a new skill shows in the / menu and its instructions reach the model', async () => {
  const { app, page } = await launch()
  await page.getByTestId('open-plugins').click()
  await page.getByTestId('new-skill').click()
  await page.getByTestId('skill-name').fill('Weekly report')
  await page.getByTestId('skill-description').fill('My weekly team update')
  await page.getByTestId('skill-instructions').fill('Three wins, then blockers.')
  await page.getByTestId('skill-save').click()
  await expect(page.getByTestId('plugins-notice')).toContainText('/weekly-report')
  await page.getByTestId('new-chat').click()
  await page.getByTestId('composer-input').fill('/week')
  await expect(page.getByTestId('skill-option')).toHaveCount(1)
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('composer-input')).toHaveValue('/weekly-report ')
  await page.keyboard.type('for Friday')
  await page.keyboard.press('Enter')
  // the fake model echoes what it got: the user's words plus the skill's instructions
  await expect(page.getByTestId('message-assistant').last()).toContainText('Three wins, then blockers.')
  await expect(page.getByTestId('command-label')).toHaveText('/weekly-report')
  await app.close()
})

test('turning a plugin off hides its skills from the / menu', async () => {
  const { app, page } = await launch()
  await page.getByTestId('composer-input').fill('/')
  await expect(page.getByTestId('skill-option').filter({ hasText: '/plan-trip' })).toBeVisible()
  await page.getByTestId('composer-input').fill('')
  await page.getByTestId('open-plugins').click()
  await page.locator('[data-testid=plugin][data-id=trip-planner]').getByTestId('plugin-toggle').click()
  await page.getByTestId('new-chat').click()
  await page.getByTestId('composer-input').fill('/')
  await expect(page.getByTestId('skill-option').filter({ hasText: '/quiz-me' })).toBeVisible()
  await expect(page.getByTestId('skill-option').filter({ hasText: '/plan-trip' })).toHaveCount(0)
  await app.close()
})

test('connecting an online app by link signs in through the browser and shows on its card', async () => {
  const { startHttpFixture } = await import('../test/fixtures/mcp-http-server')
  const fx = await startHttpFixture({ auth: true })
  const { app, page } = await launch()
  await page.getByTestId('open-plugins').click()
  await page.getByTestId('plugins-add').click()
  await page.getByTestId('connect-app').click()
  await page.getByTestId('connect-command').fill(fx.url)
  await expect(page.getByTestId('connect-dialog')).toContainText('Headers (optional)')
  await page.getByTestId('connect-save').click()
  await expect(page.getByTestId('plugins-notice')).toHaveText('Connected. Hob can use it in your next message.')
  expect(fx.state.registered).toHaveLength(1)
  const card = page.locator('[data-testid=plugin][data-id=local-app]')
  await expect(card).toContainText('Connects to an online service')
  await expect(card).toContainText('echo')
  await expect(card.getByRole('button', { name: 'Sign out' })).toBeVisible()
  await app.close()
  await fx.close()
})

test('an .mcpb bundle is added with its icon and asks for the settings it needs', async () => {
  const { execFileSync } = await import('node:child_process')
  const { copyFileSync, mkdirSync, renameSync, writeFileSync } = await import('node:fs')
  const root = mkdtempSync(join(tmpdir(), 'hob-mcpb-'))
  const dir = join(root, 'b')
  mkdirSync(join(dir, 'server'), { recursive: true })
  copyFileSync(join(import.meta.dirname, '../test/fixtures/mcp-server.mjs'), join(dir, 'server/index.mjs'))
  writeFileSync(join(dir, 'icon.png'), Buffer.from('89504e470d0a1a0a', 'hex'))
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
    manifest_version: '0.3', name: 'bundle-notes', display_name: 'Bundle Notes', version: '1.0.0', description: 'Notes from a bundle.', author: { name: 'Ada' }, icon: 'icon.png',
    server: { type: 'node', entry_point: 'server/index.mjs', mcp_config: { command: 'node', args: ['${__dirname}/server/index.mjs'], env: { FIXTURE_KEY: '${user_config.api_key}' } } },
    user_config: { api_key: { type: 'string', title: 'API key', sensitive: true, required: true }, folders: { type: 'directory', title: 'Folders', multiple: true, default: ['${HOME}/Desktop'] } },
  }))
  const file = join(root, 'notes.mcpb')
  // Windows has no zip command; its tar makes zips, choosing the format from a .zip name
  if (process.platform === 'win32') { execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-c', '-f', `${file}.zip`, '.'], { cwd: dir }); renameSync(`${file}.zip`, file) }
  else execFileSync('zip', ['-qr', file, '.'], { cwd: dir })
  const { app, page } = await launch()
  await page.getByTestId('open-plugins').click()
  await page.evaluate((f) => (window as unknown as { hob: { plugins: { addFile(p: string): Promise<unknown> } } }).hob.plugins.addFile(f), file)
  const card = page.locator('[data-testid=plugin][data-id=bundle-notes]')
  await expect(card).toContainText('Bundle Notes')
  await expect(card.locator('img')).toHaveAttribute('src', /^data:image\/png/)
  await expect(card.getByTestId('plugin-error')).toHaveText('Fill in “API key” to use it.')
  await card.getByRole('button', { name: /Bundle Notes/ }).click()
  await expect(card).toContainText('API key (needed)')
  await expect(card).toContainText(/[\\/]Desktop/)
  await card.locator('input[type=password]').fill('k-1')
  await card.locator('input[type=password]').blur()
  await expect(card.getByTestId('plugin-error')).toHaveCount(0)
  await app.close()
})
