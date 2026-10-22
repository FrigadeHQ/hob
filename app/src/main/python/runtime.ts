import { execFile } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ChecksumError, realDeps } from '../downloader'
import { installedVersions, installPackages, nameOf, sitePackagesOf } from './packages'
import { SEARXNG_SHA256, SEARXNG_URL } from '../search/searxng'

// Pinned and checksummed: python-build-standalone release ≥2 weeks old at pin time.
export const PY_RELEASE = '20260929'
export const PY_VERSION = '3.12.14'
export const PY_BUILDS: Record<string, { triple: string; sha256: string; sizeGB: number }> = {
  'darwin-arm64': { triple: 'aarch64-apple-darwin', sha256: 'de6b8f94fa765639b423ea353ab340669704c7186f96ee3cab389dcfde770c3c', sizeGB: 0.03 },
  'darwin-x64': { triple: 'x86_64-apple-darwin', sha256: 'f51ec8a7fa0ede129a5e2e942a2a453ba4830adaca2289da4449390e42443292', sizeGB: 0.03 },
  'win32-x64': { triple: 'x86_64-pc-windows-msvc', sha256: '28728baf30b65e263f0b25c5a85be8226e7ab0d212fbadd6a8f0f796139fa804', sizeGB: 0.05 },
  'linux-x64': { triple: 'x86_64-unknown-linux-gnu', sha256: '06c90b93f419b63371c18f20fed0558a1a901f6518c3c24f755077e048447e7f', sizeGB: 0.07 },
  'linux-arm64': { triple: 'aarch64-unknown-linux-gnu', sha256: '9c797cf657f6dced51d3e74eeabd7c1ca742d5bf10f66080a290e424ced8edaf', sizeGB: 0.06 },
}
// Everything the stack pulls in is pinned (each release ≥2 weeks old at pin time), so every install is the same.
// pip may still add platform-only extras (e.g. tzdata on Windows).
export const PY_PACKAGES = [
  'pandas==3.0.6', 'numpy==2.5.3', 'matplotlib==3.11.2', 'openpyxl==3.1.5', 'python-docx==1.2.0', 'pypdf==6.19.0',
  // making PDFs ("put it in a nice PDF"): without it small models gave up or installed one each time
  'fpdf2==2.8.9', 'defusedxml==0.7.1',
  // PowerPoint, next to Word (python-docx) and Excel (openpyxl): the Office files people have
  'python-pptx==1.0.2', 'XlsxWriter==3.2.9',
  'contourpy==1.4.0', 'cycler==0.12.1', 'et_xmlfile==2.0.0', 'fonttools==4.66.1', 'kiwisolver==1.5.1', 'lxml==6.1.3',
  'packaging==26.3', 'pillow==12.3.0', 'pyparsing==3.3.3', 'python-dateutil==2.9.0.post0', 'six==1.17.0', 'typing_extensions==4.16.0',
  // web search (SearXNG) and what it pulls in
  'annotated-doc==0.0.5', 'babel==2.18.0', 'blinker==1.9.0', 'certifi==2026.7.22', 'cffi==2.1.1', 'click==8.5.0', 'curl_cffi==0.16.3',
  'flask==3.1.3', 'flask-babel==4.0.0', 'isodate==0.7.2', 'itsdangerous==2.2.0', 'jinja2==3.1.6', 'markdown-it-py==4.2.0', 'markupsafe==3.0.3',
  'mdurl==0.1.2', 'msgspec==0.21.1', 'pycparser==3.0', 'pygments==2.21.0', 'pytz==2026.4', 'pyyaml==6.0.3', 'rich==15.0.0', 'shellingham==1.5.4',
  'typer==0.27.2', 'valkey==6.1.1', 'werkzeug==3.1.9', 'whitenoise==6.12.0',
]

export const pyUrl = (key: string) =>
  `https://github.com/astral-sh/python-build-standalone/releases/download/${PY_RELEASE}/cpython-${PY_VERSION}+${PY_RELEASE}-${PY_BUILDS[key].triple}-install_only.tar.gz`
export const pythonBin = (root: string, platform: string = process.platform) =>
  platform === 'win32' ? join(root, 'python', 'python.exe') : join(root, 'python', 'bin', 'python3')

export type RuntimeDeps = {
  /** download + sha256-verify a file into dir; returns its path */
  fetchFile(url: string, sha256: string, sizeGB: number, dir: string, onProgress: (fraction: number) => void, name?: string): Promise<string>
  /** run a command; rejects on a non-zero exit */
  exec(cmd: string, args: string[]): Promise<void>
}

export const realRuntimeDeps: RuntimeDeps = {
  // Small (30–70 MB), so a plain fetch without resume; the model downloader only takes .gguf names.
  async fetchFile(url, sha256, _sizeGB, dir, onProgress, name = 'python.tar.gz') {
    mkdirSync(dir, { recursive: true })
    const dest = join(dir, name)
    const res = await fetch(url)
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`)
    const total = Number(res.headers.get('content-length')) || 0
    const file = createWriteStream(dest)
    let got = 0
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      got += chunk.length
      if (!file.write(chunk)) await new Promise<void>((r) => file.once('drain', () => r()))
      if (total) onProgress(got / total)
    }
    await new Promise<void>((resolve, reject) => file.end((err?: Error | null) => (err ? reject(err) : resolve())))
    if ((await realDeps.hashFile(dest)) !== sha256) { rmSync(dest, { force: true }); throw new ChecksumError('Code tools download was corrupted') }
    return dest
  },
  exec: (cmd, args) => new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024 }, (err, _out, stderr) => (err ? reject(new Error(`${err.message}\n${stderr}`)) : resolve()))
  }),
}

const MARKER = 'ready.json'

/** Python + data libraries, installed into app data on first need. */
export class PythonRuntime {
  private installing: Promise<string> | undefined
  constructor(private root: string, private deps: RuntimeDeps, private key = `${process.platform}-${process.arch}`) {}

  get python() { return pythonBin(this.root, this.key.split('-')[0]) }
  get dir() { return this.root }

  /** packages the user's code installed (a venv on top of this Python) */
  get packagesDir() { return join(this.root, 'packages') }
  sitePackages() { return sitePackagesOf(this.packagesDir, this.key.split('-')[0]) }
  private baseSitePackages() { return this.key.startsWith('win32') ? join(this.root, 'python', 'Lib', 'site-packages') : sitePackagesOf(join(this.root, 'python'), this.key.split('-')[0]) }

  /** installed version of each package (by its PyPI name), from the user's packages or Hob's own */
  versions(names: string[]): Record<string, string | undefined> {
    const all = installedVersions([this.sitePackages(), this.baseSitePackages()])
    return Object.fromEntries(names.map((n) => [n, all.get(nameOf(n))]))
  }

  /** from PyPI, prebuilt only; resolves to the versions now installed */
  async installPackages(specs: string[]): Promise<{ ok: true; versions: Record<string, string | undefined> } | { ok: false; error: string }> {
    const python = await this.ensure()
    const r = await installPackages(python, this.packagesDir, PY_VERSION, specs, this.deps.exec)
    return r.ok ? { ok: true, versions: this.versions(specs) } : r
  }

  isReady(): boolean {
    try {
      const m = JSON.parse(readFileSync(join(this.root, MARKER), 'utf8'))
      // a different release or package list means an update: reinstall
      return m.release === PY_RELEASE && JSON.stringify(m.packages) === JSON.stringify(PY_PACKAGES) && m.searxng === SEARXNG_SHA256 && existsSync(this.python)
    } catch { return false }
  }

  /** Install once; concurrent callers share the same install. Resolves to the python binary. */
  ensure(onProgress: (fraction: number) => void = () => {}): Promise<string> {
    if (this.isReady()) return Promise.resolve(this.python)
    return (this.installing ??= this.install(onProgress).finally(() => { this.installing = undefined }))
  }

  private async install(onProgress: (fraction: number) => void): Promise<string> {
    const build = PY_BUILDS[this.key]
    if (!build) throw new Error(`Code tools aren't available on this computer (${this.key}).`)
    mkdirSync(this.root, { recursive: true })
    rmSync(join(this.root, 'python'), { recursive: true, force: true })
    rmSync(join(this.root, MARKER), { force: true })
    const tgz = await this.deps.fetchFile(pyUrl(this.key), build.sha256, build.sizeGB, this.root, (f) => onProgress(f * 0.3))
    await this.deps.exec('tar', ['-xzf', tgz, '-C', this.root])
    const searx = await this.deps.fetchFile(SEARXNG_URL, SEARXNG_SHA256, 0.01, this.root, () => {}, 'searxng.tar.gz')
    rmSync(join(this.root, 'searxng'), { recursive: true, force: true })
    mkdirSync(join(this.root, 'searxng'))
    await this.deps.exec('tar', ['-xzf', searx, '-C', join(this.root, 'searxng'), '--strip-components=1'])
    rmSync(searx, { force: true })
    onProgress(0.35)
    await this.deps.exec(this.python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '--only-binary=:all:', ...PY_PACKAGES])
    onProgress(0.9)
    // precompiled bytecode: the sandbox can't write __pycache__, and first runs drop from ~13 s to <1 s
    await this.deps.exec(this.python, ['-m', 'compileall', '-q', join(this.root, 'python')]).catch(() => {})
    rmSync(tgz, { force: true })
    writeFileSync(join(this.root, MARKER), JSON.stringify({ release: PY_RELEASE, packages: PY_PACKAGES, searxng: SEARXNG_SHA256 }))
    onProgress(1)
    return this.python
  }
}
