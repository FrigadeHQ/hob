import { FolderOpen, ShieldCheck } from 'lucide-react'
import type { ApprovalAnswer, ApprovalRequest } from '../../../shared/agent'
import { t } from '../../../shared/i18n'

export function ApprovalCard({ req, onAnswer }: { req: ApprovalRequest; onAnswer(a: ApprovalAnswer): void }) {
  const btn = 'rounded-control px-3 py-1.5 text-ui font-medium transition-colors'
  const Icon = req.access ? FolderOpen : ShieldCheck
  return (
    <div data-testid="approval" data-access={req.access ? 'true' : 'false'} className="my-3 rounded-card border border-line-strong bg-surface p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <Icon size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-ink-soft" />
        <div className="min-w-0 flex-1">
          <p className="text-body font-medium">{req.text}</p>
          {req.access && req.detail && <p className="mt-1 text-ui text-ink-soft">{t('Hob can then see the files in {folder} in this chat, and asks before changing any.', { folder: req.detail })}</p>}
          {!req.access && req.detail && (
            <pre data-testid="approval-detail" className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-control bg-line/40 px-3 py-2 font-mono text-ui text-ink-soft">{req.detail}</pre>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 ps-[30px]">
        <button data-testid="approval-allow" onClick={() => onAnswer('allow')} className={`${btn} bg-ink text-paper hover:opacity-90`}>{req.access ? t('Allow access') : t('Allow')}</button>
        {req.folder && !req.access && <button data-testid="approval-always" onClick={() => onAnswer('always')} className={`${btn} border border-line-strong hover:bg-line/60`}>{t('Always in this folder')}</button>}
        <button data-testid="approval-deny" onClick={() => onAnswer('deny')} className={`${btn} text-ink-soft hover:bg-line/60`}>{req.access ? t('Not now') : t('Deny')}</button>
      </div>
    </div>
  )
}
