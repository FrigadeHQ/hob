// Builds Hob's native helpers (Mac only): resources/bin/hob-pdf from native/hob-pdf/main.swift.
// Skipped when the binary is newer than its source, or when there's no Swift compiler (non-Mac builds).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'native/hob-pdf/main.swift')
const out = join(root, 'resources/bin/hob-pdf')
if (process.platform !== 'darwin') process.exit(0)
if (existsSync(out) && statSync(out).mtimeMs > statSync(src).mtimeMs) process.exit(0)
mkdirSync(dirname(out), { recursive: true })
execFileSync('xcrun', ['swiftc', '-O', '-target', 'arm64-apple-macos13', src, '-o', out], { stdio: 'inherit' })
console.log('built', out)
