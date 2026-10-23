import { open, rename, rm, stat, statfs } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * Gemma's E models (E2B, E4B) carry a per-layer embedding table, about 2.3 GB in E4B, that only the processor reads,
 * a row at a time. llama.cpp maps one stretch of the file into the graphics chip's memory, from the first tensor it
 * uses to the last, and those files start with two small ones it uses, so the table landed in the middle of it:
 * memory macOS can't page out, enough to freeze a 16 GB Mac. Moved to the front, the table stays out of that stretch.
 */
const CPU_ONLY = ['per_layer_token_embd.weight']

/** where its data is (offset from the data start, size), and where its entry sits in the header */
export interface TensorInfo { name: string; offset: number; size: number; offsetAt: number; entry: [number, number] }

/** the tensor table of a GGUF file: where each tensor's data starts and how long it is */
export function readTensors(head: Buffer, fileSize = head.length): { dataStart: number; alignment: number; tensors: TensorInfo[] } {
  let p = 0
  const u32 = () => { const v = head.readUInt32LE(p); p += 4; return v }
  const u64 = () => { const v = Number(head.readBigUInt64LE(p)); p += 8; return v }
  const str = () => { const n = u64(); const s = head.toString('utf8', p, p + n); p += n; return s }
  const SIZES: Record<number, number> = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 }
  const skip = (type: number): void => {
    if (type === 8) { str(); return }
    if (type === 9) { const t = u32(); const n = u64(); for (let i = 0; i < n; i++) skip(t); return }
    p += SIZES[type]
  }
  if (head.toString('ascii', 0, 4) !== 'GGUF') throw new Error('not a GGUF file')
  p = 4
  const version = u32()
  if (version < 2) throw new Error(`GGUF version ${version}`)
  const nTensors = u64(), nKv = u64()
  let alignment = 32
  for (let i = 0; i < nKv; i++) {
    const key = str(); const type = u32()
    if (key === 'general.alignment' && type === 4) alignment = head.readUInt32LE(p)
    skip(type)
  }
  const raw: Omit<TensorInfo, 'size'>[] = []
  for (let i = 0; i < nTensors; i++) {
    const start = p
    const name = str(); const dims = u32(); p += 8 * dims; p += 4
    const offsetAt = p
    const offset = u64()
    raw.push({ name, offset, offsetAt, entry: [start, p] })
  }
  const dataStart = Math.ceil(p / alignment) * alignment
  const byOffset = [...raw].sort((a, b) => a.offset - b.offset)
  const size = new Map(byOffset.map((t, i) => [t, (byOffset[i + 1]?.offset ?? fileSize - dataStart) - t.offset]))
  return { dataStart, alignment, tensors: raw.map((t) => ({ ...t, size: size.get(t)! })) }
}

/** rewrites the file with the processor-only tensors first; false when there's nothing to move (or it's not GGUF) */
export async function cpuTensorsFirst(path: string): Promise<boolean> {
  const { size: fileSize } = await stat(path)
  const src = await open(path, 'r')
  let table: ReturnType<typeof readTensors>
  let head: Buffer
  try {
    // the tensor table sits at the start; models' tables are well under this
    head = Buffer.alloc(Math.min(fileSize, 64 * 1024 * 1024))
    await src.read(head, 0, head.length, 0)
    try { table = readTensors(head, fileSize) } catch { return false }
    const { tensors, dataStart, alignment } = table
    const cpu = tensors.filter((t) => CPU_ONLY.includes(t.name))
    if (!cpu.length || cpu.every((t) => t.offset < Math.min(...tensors.filter((x) => !cpu.includes(x)).map((x) => x.offset)))) return false

    // a copy is written next to it first
    const fs = await statfs(dirname(path))
    if (fs.bavail * fs.bsize < fileSize + 1e9) return false

    const order = [...cpu, ...tensors.filter((t) => !cpu.includes(t)).sort((a, b) => a.offset - b.offset)]
    // llama.cpp reads the data in the order the header lists the tensors, so the list is reordered too;
    // its entries only change places, so the header keeps its length and the data its start
    const first = Math.min(...tensors.map((t) => t.entry[0]))
    const entries: Buffer[] = []
    const placed: { t: TensorInfo; to: number }[] = []
    let off = 0
    for (const t of order) {
      off = Math.ceil(off / alignment) * alignment
      placed.push({ t, to: off })
      const e = Buffer.from(head.subarray(t.entry[0], t.entry[1]))
      e.writeBigUInt64LE(BigInt(off), t.offsetAt - t.entry[0])
      entries.push(e)
      off += t.size
    }
    const header = Buffer.concat([head.subarray(0, first), ...entries, head.subarray(Math.max(...tensors.map((t) => t.entry[1])), dataStart)])
    const tmp = `${path}.reorder`
    const dst = await open(tmp, 'w')
    try {
      await dst.write(header, 0, header.length, 0)
      const chunk = Buffer.alloc(64 * 1024 * 1024)
      for (const { t, to } of placed) {
        for (let done = 0; done < t.size;) {
          const n = Math.min(chunk.length, t.size - done)
          const { bytesRead } = await src.read(chunk, 0, n, dataStart + t.offset + done)
          if (bytesRead !== n) throw new Error('short read')
          await dst.write(chunk, 0, n, dataStart + to + done)
          done += n
        }
      }
      await dst.sync()
    } catch (err) {
      await dst.close(); await rm(tmp, { force: true }); throw err
    }
    await dst.close()
    await src.close()
    await rename(tmp, path)
    return true
  } finally {
    await src.close().catch(() => {})
  }
}
