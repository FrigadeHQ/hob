import { defineConfig } from '@playwright/test'

// Garth runs hidden during tests so it never pops up or takes focus; GARTH_BACKGROUND=0 to watch
process.env.GARTH_BACKGROUND ??= '1'

// CI machines are slower: a test that only passes on its second try is reported as flaky, not hidden
export default defineConfig({ testDir: 'e2e', timeout: 60_000, retries: process.env.CI ? 1 : 0 })
