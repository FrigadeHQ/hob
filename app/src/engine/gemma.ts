import { Gemma4ChatWrapper, LlamaText, SpecialTokensText, type ChatModelFunctions, type ChatWrapperGenerateContextStateOptions } from 'node-llama-cpp'

/**
 * Gemma 4's own tool-call format, from its chat template: `call:move_file{from:<|"|>a.txt<|"|>}`, text between
 * `<|"|>` tokens and keys without quotes. node-llama-cpp has Gemma write JSON instead, and a grammar blocks the
 * `<|"|>` it reaches for to end a text value: about one call in four came out garbled ("shopping.txt'}}<tool_call|>…"),
 * and some ran on for minutes inside an argument, showing nothing.
 */
const Q = '<|"|>'
export const CALL_START = '<|tool_call>'
export const CALL_END = '<tool_call|>'

type Value = string | number | boolean | null | Value[] | { [k: string]: Value }

/** a value as Gemma writes it (format_argument); keys without quotes, sorted as the template sorts them */
export function argumentText(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'string') return `${Q}${v}${Q}`
  if (typeof v === 'boolean' || typeof v === 'number') return String(v)
  if (Array.isArray(v)) return `[${v.map(argumentText).join(',')}]`
  if (typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${k}:${argumentText((v as Record<string, unknown>)[k])}`).join(',')}}`
  return String(v)
}

type Schema = Record<string, unknown>
const typeOf = (s: Schema) => {
  const t = Array.isArray(s.type) ? s.type.find((x) => x !== 'null') ?? 'string' : s.type ?? 'string'
  return String(t).toUpperCase()
}
/** a parameter list as the template writes it (format_parameters) */
function paramsText(properties: Record<string, Schema>): string {
  return Object.keys(properties).sort().map((key) => {
    const p = properties[key]
    const parts: string[] = []
    if (p.description) parts.push(`description:${Q}${p.description}${Q}`)
    const type = typeOf(p)
    if (type === 'STRING' && Array.isArray(p.enum)) parts.push(`enum:${argumentText(p.enum)}`)
    if (type === 'ARRAY' && p.items && typeof p.items === 'object') {
      const items = p.items as Schema
      const inner: string[] = []
      for (const k of Object.keys(items).sort()) {
        if (items[k] == null) continue
        if (k === 'properties') inner.push(`properties:{${paramsText(items.properties as Record<string, Schema>)}}`)
        else if (k === 'required') inner.push(`required:[${(items.required as string[]).map((r) => `${Q}${r}${Q}`).join(',')}]`)
        else if (k === 'type') inner.push(`type:${argumentText(typeOf(items))}`)
        else inner.push(`${k}:${argumentText(items[k])}`)
      }
      parts.push(`items:{${inner.join(',')}}`)
    }
    if (Array.isArray(p.type) && p.type.includes('null')) parts.push('nullable:true')
    if (type === 'OBJECT' && p.properties && typeof p.properties === 'object') {
      parts.push(`properties:{${paramsText(p.properties as Record<string, Schema>)}}`)
      if (Array.isArray(p.required) && p.required.length) parts.push(`required:[${p.required.map((r) => `${Q}${r}${Q}`).join(',')}]`)
    }
    parts.push(`type:${Q}${type}${Q}`)
    return `${key}:{${parts.join(',')}}`
  }).join(',')
}

/** a tool as the template declares it (format_function_declaration) */
export function declarationText(name: string, f: { description?: string; params?: Schema }): string {
  const params = f.params
  let out = `declaration:${name}{description:${Q}${f.description ?? ''}${Q}`
  if (params) {
    out += ',parameters:{'
    if (params.properties && Object.keys(params.properties).length) out += `properties:{${paramsText(params.properties as Record<string, Schema>)}},`
    if (Array.isArray(params.required) && params.required.length) out += `required:[${params.required.map((r) => `${Q}${r}${Q}`).join(',')}],`
    out += `type:${Q}${String(params.type ?? 'object').toUpperCase()}${Q}}`
  }
  return `${out}}`
}

/** reads `name{key:value,…}`, the text between `<|tool_call>call:` and `<tool_call|>`; a call cut short keeps what it has */
export function parseCall(text: string): { name: string; args: Record<string, Value> } | undefined {
  const m = /^\s*([A-Za-z0-9_.-]+)\s*\{/.exec(text)
  if (!m) return undefined
  let i = m[0].length - 1
  const ws = () => { while (i < text.length && /\s/.test(text[i])) i++ }
  const key = (): string => {
    ws()
    if (text.startsWith(Q, i)) { const end = text.indexOf(Q, i + Q.length); const k = text.slice(i + Q.length, end < 0 ? undefined : end); i = end < 0 ? text.length : end + Q.length; return k }
    if (text[i] === '"') { const end = text.indexOf('"', i + 1); const k = text.slice(i + 1, end < 0 ? undefined : end); i = end < 0 ? text.length : end + 1; return k }
    const start = i
    while (i < text.length && !/[:,}\s]/.test(text[i])) i++
    return text.slice(start, i)
  }
  const value = (): Value => {
    ws()
    if (text.startsWith(Q, i)) {
      const end = text.indexOf(Q, i + Q.length)
      const s = text.slice(i + Q.length, end < 0 ? undefined : end)
      i = end < 0 ? text.length : end + Q.length
      return s
    }
    const c = text[i]
    if (c === '{') {
      i++
      const o: Record<string, Value> = {}
      for (;;) {
        ws()
        if (i >= text.length) return o
        if (text[i] === '}') { i++; return o }
        if (text[i] === ',') { i++; continue }
        const k = key()
        ws()
        if (text[i] !== ':') return o
        i++
        o[k] = value()
      }
    }
    if (c === '[') {
      i++
      const a: Value[] = []
      for (;;) {
        ws()
        if (i >= text.length) return a
        if (text[i] === ']') { i++; return a }
        if (text[i] === ',') { i++; continue }
        const before = i
        a.push(value())
        if (i === before) { i++; continue }
      }
    }
    if (c === '"') {
      // JSON-style text, in case the model writes it that way
      const m2 = /^"(?:[^"\\]|\\.)*"/.exec(text.slice(i))
      if (m2) { i += m2[0].length; try { return JSON.parse(m2[0]) as string } catch { return m2[0].slice(1, -1) } }
    }
    const lit = /^(true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i))
    if (lit) { i += lit[0].length; return JSON.parse(lit[0]) as Value }
    // anything else: up to the next separator, as text
    const start = i
    while (i < text.length && !/[,}\]]/.test(text[i])) i++
    return text.slice(start, i).trim()
  }
  const args = value()
  return { name: m[1], args: args && typeof args === 'object' && !Array.isArray(args) ? args : {} }
}

/**
 * node-llama-cpp's Gemma 4 wrapper with the tools, calls and results written as Gemma's own template writes them.
 * The tools are set here (not passed as functions), so node-llama-cpp leaves the calls to Hob (gemmaTurn in worker).
 */
export class HobGemmaChatWrapper extends Gemma4ChatWrapper {
  tools: ChatModelFunctions = {}

  override generateContextState(o: ChatWrapperGenerateContextStateOptions) {
    return super.generateContextState({ ...o, availableFunctions: this.tools, documentFunctionParams: true })
  }
  override generateAvailableFunctionsSystemText(functions: ChatModelFunctions) {
    return LlamaText(Object.entries(functions).map(([name, f]) =>
      LlamaText([new SpecialTokensText('<|tool>'), special(declarationText(name, { description: f.description, params: f.params as Schema | undefined })), new SpecialTokensText('<tool|>')])))
  }
  override generateFunctionCall(name: string, params: unknown) {
    return LlamaText([new SpecialTokensText(`${CALL_START}call:`), name, special(argumentText(params ?? {})), new SpecialTokensText(CALL_END)])
  }
  override generateFunctionCallResult(name: string, _params: unknown, result: unknown) {
    const text = typeof result === 'string' ? result : JSON.stringify(result ?? null)
    return LlamaText([new SpecialTokensText('<|tool_response>'), `response:${name}`, special(`{value:${argumentText(text)}}`), new SpecialTokensText('<tool_response|>')])
  }
}

/** text with each `<|"|>` as the special token it is, the rest as plain text */
function special(text: string) {
  return LlamaText(text.split(Q).flatMap((part, i) => (i === 0 ? [part] : [new SpecialTokensText(Q), part])))
}
