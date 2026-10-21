import { dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// onnxruntime-web doesn't export its .wasm files; point an alias at its dist folder so they ship with the app
const ortDist = dirname(createRequire(import.meta.url).resolve('onnxruntime-web'))

export default defineConfig({
  main: {
    build: {
      externalizeDeps: { exclude: ['@mabel/picker'] },
      rollupOptions: {
        input: { index: resolve('src/main/index.ts'), engine: resolve('src/engine/worker.ts') },
      },
    },
  },
  preload: {
    build: { rollupOptions: { input: { index: resolve('src/preload/index.ts') }, output: { format: 'cjs' } } },
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias: { 'ort-dist': ortDist } },
    worker: { format: 'es' },
    build: { rollupOptions: { input: resolve('src/renderer/index.html') } },
    plugins: [
      react(),
      tailwindcss(),
      {
        // Strict CSP for shipped builds; dev needs inline scripts for hot reload.
        name: 'mabel-csp',
        apply: 'build',
        transformIndexHtml: (html: string) =>
          html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' mabel-file:; style-src 'self' 'unsafe-inline'; img-src 'self' data: mabel-file:; font-src 'self' data:; media-src 'self' blob:" />`),
      },
    ],
  },
})
