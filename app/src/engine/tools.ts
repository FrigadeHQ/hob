import type { ToolSpec } from '../shared/agent'

export const MAX_TOOL_CALLS = 30
export const STEP_LIMIT_MESSAGE = 'Step limit reached. Stop using tools and give the user your answer now.'

type Fn = { description: string; params: Record<string, unknown>; handler(args: unknown): Promise<string> }

/** node-llama-cpp function definitions that forward every call to the main process. */
export function toolFunctions(specs: ToolSpec[], call: (name: string, args: unknown) => Promise<string>, max = MAX_TOOL_CALLS): Record<string, Fn> {
  let n = 0
  return Object.fromEntries(specs.map((s) => [s.name, {
    description: s.description,
    params: engineSchema(s.params),
    handler: async (args: unknown) => (++n > max ? STEP_LIMIT_MESSAGE : call(s.name, dropSkipped(args ?? {}, s.params))),
  }]))
}

type Schema = Record<string, unknown>
const isObj = (v: unknown): v is Schema => !!v && typeof v === 'object' && !Array.isArray(v)
const BASIC = ['string', 'number', 'integer', 'boolean', 'null', 'object', 'array']
const ANY_SIMPLE = { type: ['string', 'number', 'boolean', 'null'] }
const FORMATS = ['date-time', 'time', 'date']

/** allOf parts merged into one schema */
function mergeAll(s: Schema): Schema {
  if (!Array.isArray(s.allOf)) return s
  const { allOf, ...rest } = s
  return (allOf as unknown[]).filter(isObj).reduce<Schema>((a, b) => {
    const m = mergeAll(b)
    return { ...a, ...m, ...(isObj(a.properties) && isObj(m.properties) ? { properties: { ...a.properties, ...m.properties } } : {}), ...(Array.isArray(a.required) && Array.isArray(m.required) ? { required: [...a.required, ...m.required] } : {}) }
  }, rest)
}
/** the schema a $ref points to, inside the tool's own definitions */
function deref(s: Schema, root: Schema): Schema {
  if (typeof s.$ref !== 'string') return s
  const name = s.$ref.replace(/^#\/(\$defs|definitions)\//, '')
  const defs = (isObj(root.$defs) ? root.$defs : isObj(root.definitions) ? root.definitions : {}) as Schema
  return isObj(defs[name]) ? defs[name] as Schema : s
}
/** does the tool itself accept null here? */
function allowsNull(s: unknown, root: Schema): boolean {
  if (!isObj(s)) return false
  const x = mergeAll(deref(s, root))
  if (x.nullable === true || x.type === 'null' || (Array.isArray(x.type) && x.type.includes('null'))) return true
  const options = Array.isArray(x.anyOf) ? x.anyOf : Array.isArray(x.oneOf) ? x.oneOf : []
  return options.some((o) => allowsNull(o, root))
}

/**
 * The grammar writes every property, so optional ones may be null, meaning "skipped".
 * Remove those nulls (at any depth) before the tool sees them; nulls the tool itself accepts stay.
 */
export function dropSkipped(args: unknown, schema: unknown, root: Schema = isObj(schema) ? schema : {}): unknown {
  if (!isObj(schema)) return args
  const s = mergeAll(deref(schema, root))
  if (Array.isArray(args)) return args.map((a) => dropSkipped(a, s.items, root))
  if (!isObj(args)) return args
  const options = (Array.isArray(s.anyOf) ? s.anyOf : Array.isArray(s.oneOf) ? s.oneOf : []).filter(isObj).map((o) => mergeAll(deref(o, root)))
  if (options.length) {
    // the object choice whose fields fit best
    const keys = Object.keys(args)
    const best = options.filter((o) => isObj(o.properties)).sort((a, b) => keys.filter((k) => k in (b.properties as Schema)).length - keys.filter((k) => k in (a.properties as Schema)).length)[0]
    return best ? dropSkipped(args, best, root) : args
  }
  const props = isObj(s.properties) ? s.properties : {}
  const required = Array.isArray(s.required) ? s.required : []
  return Object.fromEntries(Object.entries(args)
    .filter(([k, v]) => !(v === null && !required.includes(k) && !allowsNull(props[k], root)))
    .map(([k, v]) => [k, dropSkipped(v, props[k], root)]))
}

/**
 * Tool schemas from MCP servers use all of JSON Schema; the local model's grammar knows a subset
 * (no anyOf/allOf, three string formats, objects and arrays only as a single type). Translate, so the
 * model can still fill in every argument.
 */
export function engineSchema(s: unknown, top = true, depth = 0): Schema {
  if (!isObj(s) || depth > 16) return top ? { type: 'object', properties: {} } : ANY_SIMPLE
  s = mergeAll(s as Schema)
  const src = s as Schema
  const out: Schema = {}
  if (typeof src.description === 'string') out.description = src.description
  if (src.$ref !== undefined) return { ...out, $ref: String(src.$ref).replace('#/definitions/', '#/$defs/') }
  if (src.const !== undefined) return { ...out, const: src.const }
  if (Array.isArray(src.enum)) return { ...out, enum: src.enum }
  const options = Array.isArray(src.anyOf) ? src.anyOf : Array.isArray(src.oneOf) ? src.oneOf : undefined
  if (options) return { ...out, oneOf: options.map((o) => engineSchema(o, false, depth + 1)) }
  let types = (Array.isArray(src.type) ? src.type : [src.type]).map(String).filter((t) => BASIC.includes(t))
  if (!types.length) types = isObj(src.properties) || top ? ['object'] : src.items !== undefined ? ['array'] : []
  if (!types.length) return { ...out, ...ANY_SIMPLE }
  if (src.nullable === true && !types.includes('null')) types.push('null')
  // the grammar builds objects and arrays only when they're the single type: split the rest into choices
  if (types.length > 1 && types.some((t) => t === 'object' || t === 'array')) {
    const { description: _d, nullable: _n, ...rest } = src
    return { ...out, oneOf: types.map((t) => engineSchema({ ...rest, type: t }, false, depth + 1)) }
  }
  const type = types.length === 1 ? types[0] : types
  out.type = type
  if (type === 'object') {
    const required = Array.isArray(src.required) ? src.required.filter((r): r is string => typeof r === 'string' && isObj(src.properties) && r in src.properties) : []
    // the grammar writes every property: an optional one may be null, meaning "not given" (dropped before the call)
    out.properties = Object.fromEntries(Object.entries(isObj(src.properties) ? src.properties : {}).map(([k, v]) => {
      const inner = engineSchema(v, false, depth + 1)
      if (required.includes(k)) return [k, inner]
      const { description, ...rest } = inner
      return [k, { ...(description !== undefined ? { description } : {}), oneOf: [rest, { type: 'null' }] }]
    }))
    if (required.length) out.required = required
    if (isObj(src.additionalProperties)) out.additionalProperties = engineSchema(src.additionalProperties, false, depth + 1)
    // a map with no named fields (or that allows extra ones) takes any keys
    else if (src.additionalProperties === true || (src.additionalProperties === undefined && !Object.keys(out.properties as Schema).length && !top)) out.additionalProperties = true
  }
  if (type === 'array') {
    if (src.items !== undefined) out.items = engineSchema(src.items, false, depth + 1)
    for (const k of ['minItems', 'maxItems']) if (typeof src[k] === 'number') out[k] = src[k]
  }
  if (type === 'string') {
    if (FORMATS.includes(String(src.format))) out.format = src.format
    for (const k of ['minLength', 'maxLength']) if (typeof src[k] === 'number') out[k] = src[k]
  }
  const defs = isObj(src.$defs) ? src.$defs : isObj(src.definitions) ? src.definitions : undefined
  if (defs) out.$defs = Object.fromEntries(Object.entries(defs).map(([k, v]) => [k, engineSchema(v, false, depth + 1)]))
  return out
}
