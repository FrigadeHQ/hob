import { join } from 'node:path'

/**
 * The tar to unpack with. Windows: its own tar.exe (bsdtar, in System32), never whichever is first on PATH:
 * Git for Windows' GNU tar reads "C:" in a path as a network host and fails.
 */
export const tarCmd = (platformKey: string) => (platformKey.startsWith('win32') ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar')
