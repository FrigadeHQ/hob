import { useEffect, useState } from 'react'
import { Calendar, Check, Circle, Mail } from 'lucide-react'
import type { MacAccess } from '../../../shared/types'
import { garth } from '../api'
import { button, Dialog } from './ui'

export const connected = (a: MacAccess | null) => !!a && a.calendar === 'granted' && a.mail === 'granted'

/**
 * Connect email and calendar on a Mac: Garth uses the Calendar and Mail apps, with every account the Mac already
 * has. One button shows the system's own prompts; nothing to sign in to.
 */
export function ConnectApps({ onClose, onTry }: { onClose(): void; onTry(prompt: string): void }) {
  const [access, setAccess] = useState<MacAccess | null>(null)
  const [asking, setAsking] = useState(false)
  useEffect(() => { void garth.mac.access().then(setAccess) }, [])
  const ask = async () => { setAsking(true); setAccess(await garth.mac.ask()); setAsking(false) }
  const done = connected(access)
  const denied = access && (access.calendar === 'denied' || access.mail === 'denied')
  const row = (Icon: typeof Mail, label: string, status?: string) => (
    <li className="flex items-center gap-2.5 text-ui">
      <Icon size={16} strokeWidth={1.75} className="text-ink-soft" />
      <span className="flex-1">{label}</span>
      {status === 'granted'
        ? <span className="inline-flex items-center gap-1 text-ink-soft"><Check size={14} />Connected</span>
        : status === 'denied' ? <span className="text-accent">Not allowed</span>
        : <span className="inline-flex items-center gap-1 text-muted"><Circle size={10} />Not yet</span>}
    </li>
  )
  return (
    <Dialog title="Connect your email and calendar" onClose={onClose} testId="connect-apps">
      <p className="text-ui text-ink-soft">
        Garth uses the Calendar and Mail apps on this Mac, with every account you added there: iCloud, Google, Outlook and more. Nothing leaves your computer, and Garth only writes email drafts. You send them.
      </p>
      <ul className="mt-4 space-y-2.5 rounded-card border border-line px-4 py-3">
        {row(Calendar, 'Calendar', access?.calendar)}
        {row(Mail, 'Mail', access?.mail)}
      </ul>
      {denied && <p className="mt-3 text-ui text-ink-soft">To change it, allow Garth in System Settings → Privacy & Security → Calendars and → Automation.</p>}
      <p className="mt-3 text-meta text-muted">
        Use Gmail or Google Calendar? Add your Google account to this Mac and turn on Mail and Calendars.{' '}
        <button className="underline underline-offset-2 hover:text-ink" onClick={() => void garth.mac.openAccounts()}>Open Internet Accounts</button>
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button className={button.quiet} onClick={onClose}>{done ? 'Close' : 'Not now'}</button>
        {done
          ? <button data-testid="connect-apps-try" className={button.primary} onClick={() => onTry("What's on my calendar this week?")}>Try “What’s on my calendar?”</button>
          : <button data-testid="connect-apps-allow" className={button.primary} disabled={asking} onClick={() => void ask()}>{asking ? 'Waiting for your Mac…' : 'Allow access'}</button>}
      </div>
    </Dialog>
  )
}
