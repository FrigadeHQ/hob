import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { inspect } from 'node:util'

/** One line per message: time, level, then the message (errors with their stack). */
export function logLine(level: string, args: unknown[], at = new Date()): string {
  return `${at.toISOString()} ${level} ${args.map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.stack ?? String(a) : inspect(a, { depth: 3 }))).join(' ')}\n`
}

/** Append, keeping the file under cap bytes: past it, the older half is dropped. */
export function writeLog(file: string, line: string, cap = 2_000_000) {
  mkdirSync(dirname(file), { recursive: true })
  if (existsSync(file) && statSync(file).size + line.length > cap) {
    const old = readFileSync(file, 'utf8')
    writeFileSync(file, old.slice(Math.max(0, old.length - Math.floor(cap / 2) + line.length)))
  }
  appendFileSync(file, line)
}

/**
 * Warnings, errors and info (where a reply's time went) also go to a file in the profile (logs/main.log), so a problem
 * on someone's computer can be looked at afterwards; nothing leaves the computer.
 */
export function logToFile(file: string) {
  for (const level of ['info', 'warn', 'error'] as const) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      original(...args)
      try { writeLog(file, logLine(level, args)) } catch { /* never let logging break the app */ }
    }
  }
}
