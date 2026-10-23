import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Journal } from '../src/main/agent/journal'
import type { TurnCtx } from '../src/main/agent/tool'
import { realDeps } from '../src/main/downloader'
import { PY_BUILDS, PythonRuntime, SEARXNG_SKIP, pyUrl, realRuntimeDeps } from '../src/main/python/runtime'
import { SEARXNG_SHA256, SEARXNG_URL, SearxngServer } from '../src/main/search/searxng'
import { tarCmd } from '../src/main/tar'
import { runPythonTool } from '../src/main/tools/python'
import { lookAtImage } from '../src/main/tools/vision'
import { webSearch } from '../src/main/tools/web'
import { VISION_MODELS } from '../src/main/vision/catalog'
import { VisionInstaller } from '../src/main/vision/install'
import { VisionServer } from '../src/main/vision/server'

/**
 * The tools as people use them, with nothing faked: Hob's own Python (sandboxed), web search through SearXNG,
 * and the image model through llama-server. Downloads about 2 GB, so it runs only with HOB_SMOKE=1
 * (CI does, on Mac, Windows and Linux).
 */
const on = process.env.HOB_SMOKE === '1'
const root = mkdtempSync(join(tmpdir(), 'hob-smoke-'))
const chatDir = join(root, 'chat'); mkdirSync(chatDir)
const python = new PythonRuntime(join(root, 'python'), realRuntimeDeps)
const searx = new SearxngServer({ python: python.python, runtimeRoot: python.dir, settingsDir: root })
const installer = new VisionInstaller(join(root, 'vision'), {
  platformKey: `${process.platform}-${process.arch}`, choose: async () => VISION_MODELS['2b'],
  download: realDeps, fetchFile: realRuntimeDeps.fetchFile, exec: realRuntimeDeps.exec,
})
const server = new VisionServer({
  command: async () => ({ cmd: await installer.serverBinary() }),
  cpuCommand: async () => { const b = await installer.cpuServerBinary(); return b ? { cmd: b } : undefined },
  model: () => installer.modelPath, mmproj: () => installer.mmprojPath,
  // CI machines have no graphics card
  useGpu: async () => false,
})
const ctx = {
  chatDir, grants: [], signal: new AbortController().signal, untrusted: false, webAccess: true,
  journal: new Journal({ backupDir: join(root, 'undo'), save: () => {} }), trash: async () => {},
  python, runTmp: join(root, 'tmp'), fetch: globalThis.fetch,
  search: async (q: string, signal: AbortSignal) => { await python.ensureSearxng(); return searx.search(q, signal) },
  vision: { state: () => installer.state, ask: (image: string, q: string, signal?: AbortSignal) => server.ask(image, q, signal) },
} satisfies TurnCtx
afterAll(() => { searx.stop(); server.stop() })

describe.runIf(on)('smoke: the real tools on this system', () => {
  // Windows can't create symlinks without admin rights, and CI runners have them, so this is checked on the archives
  // themselves: what Hob unpacks holds no links (SearXNG on every system, so a slip shows anywhere)
  const key = `${process.platform}-${process.arch}`
  const links = (archive: string, extra: string[] = []) =>
    execFileSync(tarCmd(key), ['-tvf', archive, ...extra], { maxBuffer: 256 * 1024 * 1024 }).toString().split('\n').filter((l) => /^[lh]/.test(l) || / link to /.test(l))
  it('unpacks no links from SearXNG', async () => {
    const a = await realRuntimeDeps.fetchFile(SEARXNG_URL, SEARXNG_SHA256, 0.01, root, () => {}, 'searxng-check.tar.gz')
    expect(links(a, SEARXNG_SKIP)).toEqual([])
  }, 300_000)
  it.runIf(process.platform === 'win32')('Windows: unpacks no links from Python', async () => {
    const a = await realRuntimeDeps.fetchFile(pyUrl(key), PY_BUILDS[key].sha256, PY_BUILDS[key].sizeGB, root, () => {}, 'python-check.tar.gz')
    expect(links(a)).toEqual([])
  }, 600_000)

  it('runs Python in its sandbox and saves a file in the chat folder', async () => {
    const out = await runPythonTool.run({ code: 'import pandas, openpyxl, docx, pptx\nopen("ok.txt", "w").write("ok")\nprint(6 * 7)' }, ctx)
    expect(out.failed, out.text).toBeFalsy()
    expect(out.text).toContain('42')
    expect(out.files?.some((f) => f.endsWith('ok.txt'))).toBe(true)
  }, 900_000)

  it('searches the web', async () => {
    const out = await webSearch.run({ query: 'Wikipedia' }, ctx)
    expect(out.failed, out.text).toBeFalsy()
    expect(out.text).toMatch(/https?:\/\//)
  }, 300_000)

  it('looks at an image', async () => {
    await installer.ensure()
    // a plain red picture, written by Hob's Python (Pillow)
    await runPythonTool.run({ code: 'from PIL import Image\nImage.new("RGB", (64, 64), (220, 20, 20)).save("red.png")' }, ctx)
    const out = await lookAtImage.run({ path: join(chatDir, 'red.png'), question: 'What colour is this picture? One word.' }, ctx)
    expect(out.failed, out.text).toBeFalsy()
    expect(out.text.toLowerCase()).toContain('red')
  }, 1_800_000)
})
