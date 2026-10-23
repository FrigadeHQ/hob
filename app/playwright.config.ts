import { defineConfig } from '@playwright/test'

// Hob runs hidden during tests so it never pops up or takes focus; HOB_BACKGROUND=0 to watch
process.env.HOB_BACKGROUND ??= '1'
// tests read the English text, whatever this computer's language
process.env.HOB_SYSTEM_LANGUAGES ??= 'en-US'

// CI machines are slower: a test that only passes on its second try is reported as flaky, not hidden
export default defineConfig({ testDir: 'e2e', timeout: 60_000, retries: process.env.CI ? 1 : 0 })
