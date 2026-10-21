import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { garth } from '../api'

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      data-testid="copy-reply"
      onClick={() => { void garth.copy(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }) }}
      className="inline-flex items-center gap-1.5 rounded-control px-1.5 py-1 text-meta text-muted hover:bg-line/70 hover:text-ink"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}
