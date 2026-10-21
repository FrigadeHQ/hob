import { useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { mabel } from '../api'

pdfjs.GlobalWorkerOptions.workerSrc = worker
/** past this, "Open" shows the rest: a preview, not a full reader */
const MAX_PAGES = 30

/** A PDF's pages, drawn by pdf.js (Chromium's own viewer doesn't run inside the app). */
export function PdfView({ path }: { path: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [pages, setPages] = useState<{ shown: number; total: number } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    let doc: pdfjs.PDFDocumentProxy | undefined
    void (async () => {
      try {
        const data = new Uint8Array(await (await fetch(mabel.fileUrl(path))).arrayBuffer())
        doc = await pdfjs.getDocument({ data }).promise
        const shown = Math.min(doc.numPages, MAX_PAGES)
        setPages({ shown, total: doc.numPages })
        const width = Math.min(900, (box.current?.clientWidth ?? 800) - 32)
        for (let i = 1; i <= shown && !cancelled; i++) {
          const page = await doc.getPage(i)
          const base = page.getViewport({ scale: 1 })
          const view = page.getViewport({ scale: (width / base.width) * window.devicePixelRatio })
          const canvas = document.createElement('canvas')
          canvas.width = view.width; canvas.height = view.height
          canvas.style.width = `${width}px`
          canvas.dataset.testid = 'pdf-page'
          canvas.className = 'mx-auto mb-4 block rounded-[6px] bg-white shadow-md'
          await page.render({ canvas, viewport: view }).promise
          if (!cancelled) box.current?.appendChild(canvas)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error && /password/i.test(err.message) ? 'This PDF is password-protected. Open it to read it.' : "Couldn't show this PDF. Open it to read it.")
      }
    })()
    return () => { cancelled = true; void doc?.cleanup(); if (box.current) box.current.innerHTML = '' }
  }, [path])
  return (
    <div className="h-full w-full overflow-y-auto">
      {error && <p className="mt-10 text-center text-ui text-ink-soft">{error}</p>}
      <div ref={box} data-testid="preview-pdf" className="py-2" />
      {pages && pages.total > pages.shown && <p className="pb-6 text-center text-meta text-muted">Showing {pages.shown} of {pages.total} pages. Open it to see the rest.</p>}
    </div>
  )
}
