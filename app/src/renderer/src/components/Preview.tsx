import { useEffect, useState } from 'react'
import { FolderOpen, SquareArrowOutUpRight, X } from 'lucide-react'
import { mabel } from '../api'
import { fileManager } from '../../../shared/platform'
import { PdfView } from './PdfView'

/** what Mabel shows itself; anything else opens in its own app */
const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp)$/i
const PDF = /\.pdf$/i
export const canPreview = (path: string) => IMAGE.test(path) || PDF.test(path)
const name = (p: string) => p.split(/[\\/]/).pop() ?? p

let show: ((path: string) => void) | undefined
/** a photo or PDF, full window, inside Mabel; other files open in their app */
export function previewFile(path: string) {
  if (canPreview(path) && show) show(path)
  else void mabel.files.open(path)
}

/** rendered once, near the top of the app */
export function PreviewHost() {
  const [path, setPath] = useState<string | null>(null)
  useEffect(() => { show = setPath; return () => { show = undefined } }, [])
  useEffect(() => {
    if (!path) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setPath(null) }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [path])
  if (!path) return null
  const url = mabel.fileUrl(path)
  const btn = 'inline-flex items-center gap-1.5 rounded-control px-2.5 py-1.5 text-ui text-ink-soft hover:bg-line/70 hover:text-ink'
  return (
    <div data-testid="preview" className="fade-in fixed inset-0 z-50 flex flex-col bg-paper/95 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) setPath(null) }}>
      <div className={`drag flex h-12 shrink-0 items-center gap-2 border-b border-line pr-3 ${mabel.platform === 'darwin' ? 'pl-24' : 'pl-4'}`}>
        <span className="min-w-0 flex-1 truncate text-ui font-medium">{name(path)}</span>
        <button className={`no-drag ${btn}`} onClick={() => void mabel.files.open(path)}><SquareArrowOutUpRight size={14} />Open</button>
        <button className={`no-drag ${btn}`} onClick={() => void mabel.files.show(path)}><FolderOpen size={14} />Show in {fileManager(mabel.platform)}</button>
        <button data-testid="preview-close" aria-label="Close" title="Close (Esc)" className={`no-drag ${btn}`} onClick={() => setPath(null)}><X size={16} /></button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setPath(null) }}>
        {PDF.test(path)
          ? <PdfView path={path} />
          : <img data-testid="preview-image" src={url} alt={name(path)} className="pop max-h-full max-w-full rounded-card object-contain shadow-lg" />}
      </div>
    </div>
  )
}
