import type { Step } from './agent'

// data the model's code saves on the way to an answer (the totals behind a chart, say)
const HELPER_DATA = /\.(csv|tsv|json|jsonl|parquet|feather|pkl|pickle|npy|npz)$/i
const name = (p: string) => p.split(/[\\/]/).pop() ?? p

/**
 * What a reply made, to show as cards: files it created or changed, and Hob's charts. Not a chart's data or a
 * list of moves (a means, not a result), and not data files code saved along the way unless the reply names them.
 */
export function madeFiles(steps: Step[], reply = ''): string[] {
  const used = new Set(steps.flatMap((s) => s.uses ?? []))
  const said = reply.toLowerCase()
  const helper = (s: Step, f: string) => s.tool === 'run_python' && HELPER_DATA.test(f) && !said.includes(name(f).toLowerCase())
  const files = steps.filter((s) => s.status === 'done').flatMap((s) => (s.files ?? []).filter((f) => !helper(s, f)))
  return [...new Set(files)].filter((f) => !used.has(f))
}
