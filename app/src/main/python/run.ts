import { execFileSync, spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { LANDLOCK_PY } from './landlock'

export const RUN_TIMEOUT_MS = 120_000
export const OUTPUT_CAP = 8000

/**
 * Model-written code is sandboxed on every system: macOS sandbox-exec (below), Linux Landlock (./landlock.ts),
 * Windows low integrity (lowIntegrity). macOS sandbox:
 * - writes only in the chat folder + private temp; no network
 * - can't start other programs or talk to LaunchServices/AppleEvents (`open x.command`, `osascript`)
 * - reads of user and shared locations limited to the chat folder, temp, runtime and granted folders
 */
export function sandboxProfile(readCount: number, network = false): string {
  const reads = Array.from({ length: readCount }, (_, i) => `(subpath (param "R${i}"))`).join(' ')
  return `(version 1)
(allow default)
${network ? '' : '(deny network*)\n'}(deny appleevent-send)
(deny mach-lookup (global-name "com.apple.coreservices.launchservicesd") (global-name "com.apple.lsd.mapdb") (global-name "com.apple.lsd.modifydb") (global-name "com.apple.coreservices.quarantine-resolver"))
(deny process-exec)
(allow process-exec (subpath (param "RUNTIME")))
(deny file-write*)
(allow file-write* (subpath (param "WS")) (subpath (param "TMP")) (literal "/dev/null"))
(deny file-read* (subpath (param "HOME")) (subpath "/Users") (subpath "/Volumes") (subpath "/private/tmp") (subpath "/private/var/folders"))
(allow file-read* (subpath (param "WS")) (subpath (param "TMP")) (subpath (param "RUNTIME")) ${reads})`
}

/**
 * Windows: Python runs at low integrity, the level browsers use for their sandboxes. It can only write where the
 * label is low: the chat folder and temp, labelled here. Reads and network stay open (Windows has no simple way to limit them).
 * The low-integrity copy of python.exe sits next to the real one, so pip and setup still use the normal one.
 */
const labelled = new Set<string>()
function lowIntegrity(python: string, writable: string[]): string {
  const low = join(dirname(python), 'hob-python-low.exe')
  if (!existsSync(low)) {
    copyFileSync(python, low)
    execFileSync('icacls', [low, '/setintegritylevel', 'low'], { stdio: 'ignore' })
  }
  for (const dir of writable) {
    if (labelled.has(dir)) continue
    // (OI)(CI): files and folders made inside get the label too; /T: and the ones already there
    execFileSync('icacls', [dir, '/setintegritylevel', '(OI)(CI)low', '/T', '/C', '/Q'], { stdio: 'ignore' })
    labelled.add(dir)
  }
  return low
}

export function capOutput(s: string, cap = OUTPUT_CAP): string {
  if (s.length <= cap) return s
  const half = Math.floor(cap / 2)
  return `${s.slice(0, half)}\n… [${s.length - cap} characters cut] …\n${s.slice(-half)}`
}

export type RunOpts = {
  python: string
  runtimeRoot: string
  /** the chat folder */
  cwd: string
  tmpDir: string
  code: string
  /** extra folders the code may read (granted folders) */
  readPaths?: string[]
  timeoutMs?: number
  signal?: AbortSignal
  sandbox?: boolean
  /** plugin tools: their arguments as JSON */
  stdin?: string
  /** extra environment variables (plugin settings) */
  env?: Record<string, string>
  /** plugin tools that declare it may use the internet */
  network?: boolean
  /** site-packages of the packages the user's code installed: importable, read-only */
  packages?: string
}
/** output: stdout + stderr, as the model sees it. stdout: stdout alone (plugin tools return results there) */
export type RunResult = { exitCode: number | null; output: string; stdout: string; timedOut: boolean; stopped: boolean }

export function runPython(o: RunOpts): Promise<RunResult> {
  mkdirSync(o.tmpDir, { recursive: true })
  const script = join(o.tmpDir, `run-${Date.now()}-${Math.random().toString(36).slice(2)}.py`)
  writeFileSync(script, o.code)
  const win = process.platform === 'win32'
  const env: Record<string, string> = {
    PATH: win ? (process.env.PATH ?? '') : '/usr/bin:/bin',
    TMPDIR: o.tmpDir, TEMP: o.tmpDir, TMP: o.tmpDir, HOME: o.tmpDir, USERPROFILE: o.tmpDir,
    MPLCONFIGDIR: join(o.tmpDir, 'mpl'), MPLBACKEND: 'Agg', PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1',
    ...(win ? { SYSTEMROOT: process.env.SYSTEMROOT ?? 'C:\\Windows' } : {}),
    ...o.env,
  }
  if (o.packages && existsSync(o.packages)) env.PYTHONPATH = o.packages
  // a granted folder may be gone (deleted, drive unplugged); skip it rather than fail every run
  const reads = [...(o.readPaths ?? []), ...(o.packages ? [o.packages] : [])].filter((p) => existsSync(p)).map((p) => realpathSync(p))
  const sandboxed = o.sandbox ?? true
  let cmd = o.python
  let args = [script]
  if (sandboxed && process.platform === 'darwin') {
    cmd = '/usr/bin/sandbox-exec'
    args = [
      '-p', sandboxProfile(reads.length, o.network),
      '-D', `WS=${realpathSync(o.cwd)}`, '-D', `TMP=${realpathSync(o.tmpDir)}`,
      '-D', `RUNTIME=${realpathSync(o.runtimeRoot)}`, '-D', `HOME=${realpathSync(homedir())}`,
      ...reads.flatMap((p, i) => ['-D', `R${i}=${p}`]),
      // the sandbox allows running programs by their real path only (the app's folder may be reached through a link)
      realpathSync(o.python), script,
    ]
  } else if (sandboxed && process.platform === 'linux') {
    const boot = join(o.tmpDir, 'hob-sandbox.py')
    writeFileSync(boot, LANDLOCK_PY)
    args = [boot, script]
    env.HOB_SB = JSON.stringify({ write: [realpathSync(o.cwd), realpathSync(o.tmpDir)], exec: [realpathSync(o.runtimeRoot)], read: reads })
    if (o.network) env.HOB_SB_NET = '1'
  } else if (sandboxed && win) {
    cmd = lowIntegrity(o.python, [o.cwd, o.tmpDir])
  }

  return new Promise((resolve) => {
    let out = ''
    let stdout = ''
    let timedOut = false
    let stopped = false
    let settled = false
    const child = spawn(cmd, args, { cwd: o.cwd, env, detached: !win })
    const collect = (b: Buffer) => { if (out.length < OUTPUT_CAP * 20) out += b.toString() }
    child.stdout.on('data', (b: Buffer) => { collect(b); if (stdout.length < OUTPUT_CAP * 20) stdout += b.toString() })
    child.stderr.on('data', collect)
    // detached = own process group, so killing -pid also kills anything the code spawned
    const kill = () => { try { if (win) child.kill(); else process.kill(-child.pid!, 'SIGKILL') } catch { /* already gone */ } }
    const timer = setTimeout(() => { timedOut = true; kill() }, o.timeoutMs ?? RUN_TIMEOUT_MS)
    const onAbort = () => { stopped = true; kill() }
    if (o.signal?.aborted) onAbort()
    else o.signal?.addEventListener('abort', onAbort, { once: true })
    const finish = (exitCode: number | null, extra = '') => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      o.signal?.removeEventListener('abort', onAbort)
      rmSync(script, { force: true })
      resolve({ exitCode, output: capOutput(out + extra), stdout, timedOut, stopped })
    }
    child.stdin.on('error', () => {})
    child.stdin.end(o.stdin ?? '')
    child.on('error', (err) => finish(null, err.message))
    child.on('close', (code) => finish(code))
  })
}
