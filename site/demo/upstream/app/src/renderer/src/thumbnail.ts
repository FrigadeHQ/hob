import { useEffect, useState } from 'react'

/**
 * A photo shrunk properly to w×h CSS pixels, cropped to fill (like object-cover). Chromium draws a 12 MP photo
 * at 128 px with a cheap filter that looks raw and grainy; a high-quality resize at the screen's pixel density doesn't.
 * Undefined until it's ready, or if the browser can't read the file (the caller falls back to the original).
 */
export function useThumbnail(url: string, w: number, h: number): string | undefined {
  const [thumb, setThumb] = useState<string>()
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const blob = await (await fetch(url)).blob()
        const full = await createImageBitmap(blob, { imageOrientation: 'from-image' })
        const scale = window.devicePixelRatio || 1
        const tw = Math.round(w * scale), th = Math.round(h * scale)
        // crop the middle to the card's shape first, then resize that
        const ratio = Math.min(full.width / tw, full.height / th)
        const sw = Math.round(tw * ratio), sh = Math.round(th * ratio)
        const small = await createImageBitmap(full, Math.round((full.width - sw) / 2), Math.round((full.height - sh) / 2), sw, sh, { resizeWidth: tw, resizeHeight: th, resizeQuality: 'high' })
        full.close()
        const canvas = document.createElement('canvas')
        canvas.width = tw; canvas.height = th
        canvas.getContext('2d')!.drawImage(small, 0, 0)
        small.close()
        // a data: URL (a few KB): the page's content policy allows those for images, not blob:
        if (!cancelled) setThumb(canvas.toDataURL('image/jpeg', 0.9))
      } catch { /* not an image the browser can read: show the original */ }
    })()
    return () => { cancelled = true }
  }, [url, w, h])
  return thumb
}
