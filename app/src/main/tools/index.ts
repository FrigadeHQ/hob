import { lookAtImage } from './vision'
import type { ToolSpec } from '../../shared/agent'
import type { Tool } from '../agent/tool'
import { deleteFile, listFiles, moveFile, moveFiles, openFolder, readFile, writeFile } from './files'
import { installPackagesTool, runPythonTool } from './python'
import { makeChart } from './chart'
import { photoInfo } from './photos'
import { fetchUrl, webSearch } from './web'
import { fillPdf, readPdf } from './pdf'

/** always there: working with files is what Hob is for */
export const coreTools = (): Tool<any>[] => [listFiles, readFile, writeFile, moveFile, moveFiles, deleteFile, openFolder, makeChart, lookAtImage]
/** Hob's own tools that its built-in plugins switch on (hob-plugin.json "native") */
export const nativeTools = (): Record<string, Tool<any>> => Object.fromEntries([runPythonTool, installPackagesTool, photoInfo, webSearch, fetchUrl, readPdf, fillPdf].map((t) => [t.spec.name, t]))
export const allTools = (): Tool<any>[] => [...coreTools(), ...Object.values(nativeTools())]
const WEB = new Set(['web_search', 'fetch_url'])
/** Web tools are only offered when web access is on. */
export const specsFor = (tools: Tool<any>[], webAccess: boolean): ToolSpec[] => tools.filter((t) => webAccess || !(t.needsWeb || WEB.has(t.spec.name))).map((t) => t.spec)
