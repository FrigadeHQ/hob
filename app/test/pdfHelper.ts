import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { pdfHelper } from '../src/main/tools/pdf'

/** The Mac PDF helper is built from Swift: build it for tests that need it, if it isn't yet (CI runs unit tests first). */
export function ensurePdfHelper() {
  if (process.platform !== 'darwin' || existsSync(pdfHelper())) return
  mkdirSync(join(import.meta.dirname, '../resources/bin'), { recursive: true })
  // built aside, then moved in: two test files may build it at once
  const tmp = `${pdfHelper()}.${process.pid}`
  execFileSync('swiftc', ['-O', join(import.meta.dirname, '../native/hob-pdf/main.swift'), '-o', tmp])
  renameSync(tmp, pdfHelper())
}
