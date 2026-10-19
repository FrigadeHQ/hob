import { defineConfig } from '@playwright/test'

// Hob runs hidden during tests so it never pops up or takes focus; HOB_BACKGROUND=0 to watch
process.env.HOB_BACKGROUND ??= '1'

export default defineConfig({ testDir: 'e2e', timeout: 60_000 })
