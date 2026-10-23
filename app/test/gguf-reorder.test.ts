import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { cpuTensorsFirst, readTensors } from '../src/main/gguf/reorder'

/** a tiny GGUF v3 file: one metadata key, then tensors (name, bytes) in this order */
function gguf(tensors: [string, number][], align = 32): Buffer {
  const parts: Buffer[] = []
  const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }
  const u64 = (n: number) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b }
  const str = (s: string) => Buffer.concat([u64(Buffer.byteLength(s)), Buffer.from(s)])
  parts.push(Buffer.from('GGUF'), u32(3), u64(tensors.length), u64(1))
  parts.push(str('general.name'), u32(8), str('test')) // 8 = string
  let off = 0
  for (const [name, size] of tensors) {
    parts.push(str(name), u32(1), u64(size), u32(24), u64(off)) // 24 = i8, one byte per element
    off += Math.ceil(size / align) * align
  }
  let head = Buffer.concat(parts)
  head = Buffer.concat([head, Buffer.alloc((align - (head.length % align)) % align)])
  const data = Buffer.alloc(off)
  let o = 0
  tensors.forEach(([, size], i) => { data.fill(i + 1, o, o + size); o += Math.ceil(size / align) * align })
  return Buffer.concat([head, data])
}

const bytesOf = (file: string) => {
  const buf = readFileSync(file)
  const { dataStart, tensors } = readTensors(buf)
  return Object.fromEntries(tensors.map((t) => [t.name, [...buf.subarray(dataStart + t.offset, dataStart + t.offset + t.size)].every((b) => b === buf[dataStart + t.offset]) ? buf[dataStart + t.offset] : -1]))
}

it('moves the per-layer embeddings to the front: the graphics chip maps only what it uses', async () => {
  const f = join(mkdtempSync(join(tmpdir(), 'hob-gguf-')), 'm.gguf')
  writeFileSync(f, gguf([['output_norm.weight', 40], ['per_layer_token_embd.weight', 100], ['token_embd.weight', 70], ['blk.0.attn_q.weight', 33]]))
  const before = bytesOf(f)
  expect(await cpuTensorsFirst(f)).toBe(true)
  const { tensors } = readTensors(readFileSync(f))
  expect(tensors.find((t) => t.offset === 0)?.name).toBe('per_layer_token_embd.weight')
  for (const t of tensors) expect(t.offset % 32).toBe(0)
  // llama.cpp reads the data in the order the header lists the tensors
  expect(tensors.map((t) => t.offset)).toEqual([...tensors.map((t) => t.offset)].sort((a, b) => a - b))
  // every tensor keeps its bytes
  expect(bytesOf(f)).toEqual(before)
  // once is enough
  expect(await cpuTensorsFirst(f)).toBe(false)
})

it('leaves models without per-layer embeddings, and files that are not GGUF, alone', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hob-gguf-'))
  const plain = join(dir, 'a.gguf'); writeFileSync(plain, gguf([['token_embd.weight', 10], ['blk.0.attn_q.weight', 10]]))
  const fake = join(dir, 'b.gguf'); writeFileSync(fake, 'not a model')
  const was = readFileSync(plain)
  expect(await cpuTensorsFirst(plain)).toBe(false)
  expect(readFileSync(plain).equals(was)).toBe(true)
  expect(await cpuTensorsFirst(fake)).toBe(false)
})
