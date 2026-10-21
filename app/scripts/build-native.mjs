// Builds Garth's native helpers (Mac only): resources/bin/<name> from native/<name>/main.swift
// (garth-pdf: PDFs with PDFKit and Vision; garth-mac: Calendar with EventKit).
// Skipped when the binary is newer than its source, or when there's no Swift compiler (non-Mac builds).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const helpers = ['garth-pdf', 'garth-mac']
if (process.platform !== 'darwin') process.exit(0)
for (const name of helpers) {
  const src = join(root, `native/${name}/main.swift`)
  const out = join(root, `resources/bin/${name}`)
  if (existsSync(out) && statSync(out).mtimeMs > statSync(src).mtimeMs) continue
  mkdirSync(dirname(out), { recursive: true })
  execFileSync('xcrun', ['swiftc', '-O', '-target', 'arm64-apple-macos13', src, '-o', out], { stdio: 'inherit' })
  console.log('built', out)
}
