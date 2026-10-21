import { useEffect, useState } from 'react'
import { button, Dialog } from './ui'

/** what to ask; danger: the action deletes or removes something */
export type ConfirmOptions = { title: string; body?: string; ok: string; danger?: boolean }
type Pending = ConfirmOptions & { resolve(yes: boolean): void }

let show: ((p: Pending) => void) | undefined

/** Garth's own yes/no dialog (the system one ignores the theme): resolves true for yes. */
export function confirmAction(o: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => { if (show) show({ ...o, resolve }); else resolve(false) })
}

/** rendered once, near the top of the app */
export function ConfirmHost() {
  const [p, setP] = useState<Pending | null>(null)
  useEffect(() => { show = setP; return () => { show = undefined } }, [])
  if (!p) return null
  const done = (yes: boolean) => { p.resolve(yes); setP(null) }
  // above any dialog that asked
  return (
    <div className="relative z-50">
      <Dialog title={p.title} onClose={() => done(false)} testId="confirm">
        {p.body && <p className="text-ui text-ink-soft">{p.body}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button data-testid="confirm-cancel" className={button.quiet} onClick={() => done(false)}>Cancel</button>
          <button data-testid="confirm-ok" autoFocus className={p.danger ? button.danger : button.primary} onClick={() => done(true)}>{p.ok}</button>
        </div>
      </Dialog>
    </div>
  )
}
