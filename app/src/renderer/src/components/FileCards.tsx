import { FileText, FolderOpen, Image as ImageIcon, SquareArrowOutUpRight } from 'lucide-react'
import type { Step } from '../../../shared/agent'
import { mabel } from '../api'
import { fileManager } from '../../../shared/platform'
import { ChartCard } from './ChartCard'
import { canPreview, previewFile } from './Preview'

const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i
const CHART = /\.chart\.json$/i
const name = (p: string) => p.split(/[\\/]/).pop() ?? p

/** Files the agent created or changed, with charts shown inline. */
export function FileCards({ steps }: { steps: Step[] }) {
  // a chart's data or a list of moves is a means, not a result: no card for it
  const used = new Set(steps.flatMap((s) => s.uses ?? []))
  const files = [...new Set(steps.filter((s) => s.status === 'done').flatMap((s) => s.files ?? []))].filter((f) => !used.has(f))
  if (!files.length) return null
  const reveal = `Show in ${fileManager(mabel.platform)}`
  return (
    <div className="mt-3 space-y-2">
      {files.map((f) => {
        // Mabel's own charts: drawn live, not a file to open
        if (CHART.test(f)) return <div key={f} className="overflow-hidden rounded-card border border-line bg-surface"><ChartCard path={f} /></div>
        const image = IMAGE.test(f)
        const Icon = image ? ImageIcon : FileText
        return (
          <div key={f} data-testid="file-card" className="overflow-hidden rounded-card border border-line bg-surface">
            {image && <button className="block w-full cursor-zoom-in" title="Preview" onClick={() => previewFile(f)}><img data-testid="file-image" src={mabel.fileUrl(f)} alt={name(f)} className="block max-h-96 w-full bg-white object-contain" /></button>}
            <div className="flex items-center gap-2 px-3 py-2 text-ui">
              <Icon size={16} strokeWidth={1.75} className="shrink-0 text-ink-soft" />
              <button data-testid="file-open-name" title={canPreview(f) ? 'Preview' : 'Open'} onClick={() => previewFile(f)} className="min-w-0 flex-1 truncate text-left hover:underline underline-offset-2">{name(f)}</button>
              <button onClick={() => void mabel.files.open(f)} className="inline-flex items-center gap-1 rounded-control px-2 py-1 text-ink-soft hover:bg-line/70 hover:text-ink"><SquareArrowOutUpRight size={14} />Open</button>
              <button onClick={() => void mabel.files.show(f)} className="inline-flex items-center gap-1 rounded-control px-2 py-1 text-ink-soft hover:bg-line/70 hover:text-ink"><FolderOpen size={14} />{reveal}</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
