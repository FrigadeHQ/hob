import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { dirname } from 'node:path'

type Command = { cmd: string; args?: string[] }
export type VisionServerOpts = {
  /** how to start llama-server (the graphics build) */
  command(): Promise<Command>
  /** the plain CPU build, when the graphics one won't start (Windows, Linux) */
  cpuCommand?(): Promise<Command | undefined>
  model: string
  mmproj: string
  /** stop after this long without questions, to give the memory back */
  idleMs?: number
  /** false: keep the model's text half off the graphics chip (the main model needs the room) */
  useGpu?(): Promise<boolean>
}

const freePort = () => new Promise<number>((resolve, reject) => {
  const s = createServer()
  s.once('error', reject)
  s.listen(0, '127.0.0.1', () => { const a = s.address(); s.close(() => resolve(typeof a === 'object' && a ? a.port : 0)) })
})

/** llama.cpp's server with the vision model, on this computer only: started on the first image, stopped when idle. */
export class VisionServer {
  private child: ChildProcess | undefined
  private base = ''
  private key = ''
  private starting: Promise<void> | undefined
  private idle: ReturnType<typeof setTimeout> | undefined
  /** the graphics build failed once: use the CPU one from then on */
  private cpu = false

  constructor(private o: VisionServerOpts) {}

  get running() { return !!this.child }

  private async launch(c: Command, gpu: boolean): Promise<void> {
    const port = await freePort()
    this.key = randomBytes(24).toString('hex')
    this.base = `http://127.0.0.1:${port}`
    const args = [...(c.args ?? []), '-m', this.o.model, '--mmproj', this.o.mmproj, '--host', '127.0.0.1', '--port', String(port),
      '-c', '8192', '-ngl', gpu ? '99' : '0', '--api-key', this.key, '--no-webui']
    // Linux builds ship their libraries next to the binary
    const env = { ...process.env, LD_LIBRARY_PATH: [dirname(c.cmd), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') }
    const child = spawn(c.cmd, args, { env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    this.child = child
    let err = ''
    child.stderr?.on('data', (b: Buffer) => { err = (err + b.toString()).slice(-2000) })
    let exited = false
    child.once('exit', () => { exited = true; if (this.child === child) this.child = undefined })
    // loading the model takes a while the first time (20 s for the 4B on a laptop)
    const t0 = Date.now()
    while (Date.now() - t0 < 180_000) {
      if (exited) throw new Error(`The image server stopped while starting.${err ? `\n${err.trim().split('\n').slice(-3).join('\n')}` : ''}`)
      try {
        const r = await fetch(`${this.base}/health`, { headers: { authorization: `Bearer ${this.key}` } })
        if (r.ok) return
      } catch { /* not listening yet */ }
      await new Promise((r) => setTimeout(r, 250))
    }
    child.kill()
    throw new Error('The image server took too long to start.')
  }

  private async start() {
    if (!this.cpu) {
      const gpu = (await this.o.useGpu?.()) ?? true
      try { await this.launch(await this.o.command(), gpu); return } catch (err) {
        const cpu = await this.o.cpuCommand?.()
        if (!cpu) throw err
        this.cpu = true
      }
    }
    const cpu = await this.o.cpuCommand?.()
    await this.launch(cpu ?? await this.o.command(), false)
  }

  private touch() {
    if (this.idle) clearTimeout(this.idle)
    this.idle = setTimeout(() => this.stop(), this.o.idleMs ?? 5 * 60_000)
  }

  /** image: a data: URL. Answers in plain text. */
  async ask(image: string, question: string, signal?: AbortSignal): Promise<string> {
    if (!this.child) await (this.starting ??= this.start().finally(() => { this.starting = undefined }))
    this.touch()
    const r = await fetch(`${this.base}/v1/chat/completions`, {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.key}` },
      body: JSON.stringify({
        messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: image } }, { type: 'text', text: question }] }],
        max_tokens: 1024, temperature: 0.2,
      }),
    })
    this.touch()
    if (!r.ok) throw new Error(`The image server couldn't read that image (${r.status}).`)
    const j = await r.json() as { choices?: { message?: { content?: string } }[] }
    return (j.choices?.[0]?.message?.content ?? '').trim()
  }

  stop() {
    if (this.idle) clearTimeout(this.idle)
    this.idle = undefined
    this.child?.kill()
    this.child = undefined
  }
}
