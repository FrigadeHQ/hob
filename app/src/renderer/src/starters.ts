import type { StarterRef } from '../../shared/plugins'

/** things to do with a file: they ask for one, then go */
const FILE_IDEAS: StarterRef[] = [
  { title: 'Check a document for typos', prompt: 'Check this document for spelling and grammar mistakes. List each one with its fix.', icon: 'pen-line', pluginId: '', file: true },
  { title: 'Summarize a document in 5 points', prompt: 'Summarize this in 5 short bullet points, then tell me anything I need to act on.', icon: 'list-checks', pluginId: '', file: true },
]
const EVERYDAY: StarterRef[] = [
  { title: 'Give me a 20-minute dinner idea', prompt: 'Give me a 20-minute dinner idea', icon: 'chef-hat', pluginId: '' },
  { title: 'Explain how compound interest works', prompt: 'Explain how compound interest works', icon: 'lightbulb', pluginId: '' },
]
/** a different few each new chat */
const rotate = <T,>(list: T[], seed: number, n: number) => list.map((_, i) => list[(i + seed) % list.length]).slice(0, n)
/** always shown: charts are what people most want to see Hob do with a file */
const CHART_IDEA: StarterRef = { title: 'Turn a spreadsheet into a chart', prompt: 'Make a clear chart from this spreadsheet and tell me the main takeaway.', icon: 'chart-column', pluginId: '', file: true }
/** the chart idea, one more that works on a file, two others (plugins first); the rest rotate each new chat */
export function pickStarters(fromPlugins: StarterRef[], seed: number): StarterRef[] {
  const withFile = [...FILE_IDEAS, ...fromPlugins.filter((s) => s.file)]
  const others = [...fromPlugins.filter((s) => !s.file), ...EVERYDAY]
  return [CHART_IDEA, ...rotate(withFile, seed, 1), ...rotate(others, seed, 2)]
}
