// Garth's icon and logo, from the same pixels as the app (src/shared/mascot.ts):
//   build/icon.svg  (the app icon: Garth on a warm rounded square), docs/assets/garth-logo.svg (Garth alone)
// Then: build/render.cjs turns each into a PNG, and iconutil makes build/icon.icns (see scripts/make-icons.sh).
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bodyRects, faceRects } from '../src/shared/mascot.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const rects = [...bodyRects(), ...faceRects('smile')].map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${r.fill}"/>`).join('')

// macOS icon grid: an 824×824 rounded square inside 1024, a soft shadow under it
const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF8EF"/><stop offset="1" stop-color="#F6E9DA"/></linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#5b4a3a" flood-opacity="0.22"/></filter>
  </defs>
  <rect x="100" y="100" width="824" height="824" rx="186" fill="url(#bg)" filter="url(#shadow)"/>
  <ellipse cx="512" cy="812" rx="210" ry="22" fill="#5b4a3a" opacity="0.10"/>
  <g transform="translate(212 196) scale(10)" shape-rendering="crispEdges">${rects}</g>
</svg>
`
writeFileSync(join(root, 'build/icon.svg'), icon)
writeFileSync(join(root, '../docs/assets/garth-logo.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 60 60" shape-rendering="crispEdges">${rects}</svg>\n`)
console.log('wrote build/icon.svg and docs/assets/garth-logo.svg')
