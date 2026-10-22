import { z } from 'zod'
import type { Catalog } from './types'

const Build = z.object({
  quant: z.string().min(1),
  url: z.string().url(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sizeGB: z.number().positive(),
  paramsB: z.number().positive(),
  activeParamsB: z.number().positive(),
})

const Model = z.object({
  id: z.string().regex(/^[a-z0-9.-]+$/),
  name: z.string().min(1),
  family: z.string().min(1),
  license: z.string().min(1),
  agentScore: z.number().min(0).max(10),
  chatScore: z.number().min(0).max(10),
  contextMax: z.number().int().positive(),
  minAppVersion: z.string(),
  addedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  starter: z.boolean(),
  lastResort: z.boolean().optional(),
  squeezedOf: z.string().optional(),
  description: z.string().max(80).optional(),
  builds: z.array(Build).min(1),
})

export const CatalogSchema = z.object({ version: z.literal(1), models: z.array(Model).min(1) })

export function validateCatalog(raw: unknown, allowedLicenses: string[]): { ok: true; catalog: Catalog } | { ok: false; errors: string[] } {
  const parsed = CatalogSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }
  const errors: string[] = []
  const seen = new Set<string>()
  for (const m of parsed.data.models) {
    if (seen.has(m.id)) errors.push(`duplicate id ${m.id}`)
    seen.add(m.id)
    if (!allowedLicenses.includes(m.license)) errors.push(`${m.id}: license ${m.license} not allowed`)
  }
  if (!parsed.data.models.some((m) => m.starter)) errors.push('catalog needs at least one starter model')
  return errors.length ? { ok: false, errors } : { ok: true, catalog: parsed.data as Catalog }
}
