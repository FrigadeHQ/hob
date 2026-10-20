import { execFileSync } from 'node:child_process'

/** the test machine's Python and its base prefix, or ['', ''] when there is none */
export const [python, prefix] = (() => {
  for (const cmd of ['python3', 'python']) {
    try { return execFileSync(cmd, ['-c', 'import sys, os; print(os.path.realpath(sys.executable)); print(os.path.realpath(sys.base_prefix))']).toString().trim().split(/\r?\n/) } catch { /* try the next name */ }
  }
  return ['', '']
})()
