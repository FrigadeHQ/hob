import { execFile } from 'node:child_process'

let cached: Promise<string> | undefined

/**
 * Apps opened from the Dock get a bare PATH (/usr/bin:/bin…), so `npx` or `uvx` from an MCP plugin
 * wouldn't be found. Ask the user's login shell once, like a terminal would see it.
 */
export function loginPath(): Promise<string> {
  if (cached) return cached
  const fallback = [process.env.PATH, '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].filter(Boolean).join(':')
  if (process.platform === 'win32') return (cached = Promise.resolve(process.env.PATH ?? ''))
  cached = new Promise((resolve) => {
    execFile(process.env.SHELL || '/bin/zsh', ['-ilc', 'printf "__MABEL__%s__MABEL__" "$PATH"'], { timeout: 5000 }, (err, out) => {
      const m = /__MABEL__(.*)__MABEL__/.exec(String(out))
      resolve(!err && m?.[1] ? `${m[1]}:${fallback}` : fallback)
    })
  })
  return cached
}
