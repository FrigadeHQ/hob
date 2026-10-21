import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Extra packages the user's code asked for, from PyPI. They live in a venv layered on Mabel's Python
 * (--system-site-packages), so pip only adds what isn't there yet instead of a second numpy and pandas.
 * Code still runs with Mabel's own Python, in its sandbox: the venv's site-packages is added to the path.
 */

const SPEC = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}(\[[A-Za-z0-9,._-]{1,100}\])?(==[A-Za-z0-9.!+_-]{1,50})?$/
export const MAX_PACKAGES = 10

/** "yfinance" or "yfinance==0.2.54"; never paths, links or pip options */
export function packageSpecProblem(spec: string): string | undefined {
  return SPEC.test(spec) ? undefined : `“${spec}” isn't a package name. Use plain names from PyPI, like yfinance or yfinance==0.2.54.`
}

/** PyPI treats these as the same name: Beautiful_Soup4, beautifulsoup4, beautiful-soup4 */
export const normName = (n: string) => n.toLowerCase().replace(/[-_.]+/g, '-')
export const nameOf = (spec: string) => normName(spec.split(/[[=]/)[0])

/** where a venv's packages go: Lib\site-packages on Windows, lib/python3.x/site-packages elsewhere */
export function sitePackagesOf(venv: string, platform: string = process.platform): string {
  if (platform === 'win32') return join(venv, 'Lib', 'site-packages')
  let ver = 'python3'
  try { ver = readdirSync(join(venv, 'lib')).find((d) => /^python3\.\d+$/.test(d)) ?? ver } catch { /* not made yet */ }
  return join(venv, 'lib', ver, 'site-packages')
}

/** name → version of everything installed in these site-packages folders (the first one wins) */
export function installedVersions(dirs: string[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const d of dirs) {
    let names: string[] = []
    try { names = readdirSync(d) } catch { continue }
    for (const n of names) {
      const m = /^(.+?)-([^-]+)\.dist-info$/.exec(n)
      if (m && !out.has(normName(m[1]))) out.set(normName(m[1]), m[2])
    }
  }
  return out
}

export type Exec = (cmd: string, args: string[]) => Promise<void>
const MARK = 'mabel-packages.json'

/** Install specs into the venv (made on first use, remade when Mabel's Python changes). Wheels only: nothing runs while installing. */
export async function installPackages(python: string, venv: string, pyVersion: string, specs: string[], exec: Exec): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!specs.length) return { ok: true }
  if (specs.length > MAX_PACKAGES) return { ok: false, error: `Install up to ${MAX_PACKAGES} packages at a time.` }
  for (const s of specs) { const p = packageSpecProblem(s); if (p) return { ok: false, error: p } }
  const mark = join(venv, MARK)
  let fresh = false
  try { fresh = JSON.parse(readFileSync(mark, 'utf8')).python === pyVersion } catch { /* none yet */ }
  try {
    if (!fresh) {
      rmSync(venv, { recursive: true, force: true })
      mkdirSync(venv, { recursive: true })
      await exec(python, ['-m', 'venv', '--system-site-packages', '--without-pip', venv])
      writeFileSync(mark, JSON.stringify({ python: pyVersion }))
    }
    const venvPy = process.platform === 'win32' ? join(venv, 'Scripts', 'python.exe') : join(venv, 'bin', 'python')
    await exec(python, ['-m', 'pip', '--python', venvPy, 'install', '--disable-pip-version-check', '--no-input', '--only-binary=:all:', ...specs])
    // precompiled bytecode: sandboxed code can't write __pycache__, so first imports would be slow every time
    const site = sitePackagesOf(venv)
    if (existsSync(site)) await exec(python, ['-m', 'compileall', '-q', site]).catch(() => {})
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const why = /No matching distribution|Could not find a version/i.test(msg)
      ? `PyPI has no ready-to-install version of ${specs.join(', ')} for this computer (Mabel only installs prebuilt packages). Check the name, or try without a version.`
      : /resolve|Temporary failure|ConnectionError|Max retries/i.test(msg) ? "Couldn't reach PyPI. Check the internet connection." : msg.split('\n').slice(-6).join('\n')
    return { ok: false, error: why }
  }
}
