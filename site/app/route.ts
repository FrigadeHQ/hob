import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const dynamic = 'force-static'

export function GET() {
  return new Response(readFileSync(join(process.cwd(), 'content/home.html'), 'utf8'), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
