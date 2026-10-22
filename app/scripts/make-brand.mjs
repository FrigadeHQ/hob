// Garth's icon and logo reuse the app's body artwork and shared pixel face:
//   build/icon.svg  (the app icon: Garth on a warm rounded square), docs/assets/garth-logo.svg (Garth alone)
// Then: build/render.cjs turns each into a PNG, and iconutil makes build/icon.icns (see scripts/make-icons.sh).
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { faceRects, tintMatrix } from '../src/shared/mascot.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const body = readFileSync(join(root, 'src/renderer/src/assets/garth-body.png')).toString('base64')
const face = faceRects('smile').map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${r.fill}"/>`).join('')
// Use the same crop as Mascot.tsx so the face lines up in both places.
const mascot = `<svg width="60" height="60" viewBox="158 155.5 937 937"><filter id="tint" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${tintMatrix()}"/></filter><image href="data:image/png;base64,${body}" width="1254" height="1254" filter="url(#tint)"/></svg><g shape-rendering="crispEdges">${face}</g>`

// macOS icon grid: an 824×824 rounded square inside 1024, a soft shadow under it
const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF8EF"/><stop offset="1" stop-color="#F6E9DA"/></linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#5b4a3a" flood-opacity="0.22"/></filter>
  </defs>
  <rect x="100" y="100" width="824" height="824" rx="186" fill="url(#bg)" filter="url(#shadow)"/>
  <ellipse cx="512" cy="812" rx="210" ry="22" fill="#5b4a3a" opacity="0.10"/>
  <g transform="translate(212 196) scale(10)" shape-rendering="crispEdges">${mascot}</g>
</svg>
`
writeFileSync(join(root, 'build/icon.svg'), icon)
writeFileSync(join(root, '../docs/assets/garth-logo.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 60 60" shape-rendering="crispEdges">${mascot}</svg>\n`)
console.log('wrote build/icon.svg and docs/assets/garth-logo.svg')
