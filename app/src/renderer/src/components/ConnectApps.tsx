import { useEffect, useState } from 'react'
import { Calendar, Check, Circle, Mail } from 'lucide-react'
import type { AccountsState, MacAccess } from '../../../shared/types'
import { hob } from '../api'
import { button, Dialog } from './ui'
import { t } from '../../../shared/i18n'

export const connected = (a: MacAccess | null | undefined) => !!a && a.calendar === 'granted' && a.mail === 'granted'

export function useMacAccess() {
  const [access, setAccess] = useState<MacAccess | null | undefined>(undefined)
  useEffect(() => {
    const refresh = () => void hob.mac.access().then(setAccess)
    refresh()
    const unsubscribe = hob.mac.onChanged(setAccess)
    window.addEventListener('focus', refresh)
    return () => { unsubscribe(); window.removeEventListener('focus', refresh) }
  }, [])
  return access
}

/** the providers' own marks, as their sign-in guidelines ask for */
const GoogleMark = () => (
  <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.2l7.9 6.1C12.4 13.7 17.7 9.5 24 9.5z" /><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.2z" /><path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C1 16.5 0 20.1 0 24s1 7.5 2.6 10.8l7.9-6.1z" /><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.2-8.5 2.2-6.3 0-11.6-4.2-13.5-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" /></svg>
)
const MicrosoftMark = () => (
  <svg width="15" height="15" viewBox="0 0 22 22" aria-hidden="true"><path fill="#F25022" d="M0 0h10v10H0z" /><path fill="#7FBA00" d="M12 0h10v10H12z" /><path fill="#00A4EF" d="M0 12h10v10H0z" /><path fill="#FFB900" d="M12 12h10v10H12z" /></svg>
)
const NAMES = { google: 'Google', microsoft: 'Microsoft' } as const

/**
 * Connect email and calendar: sign in with Google or Microsoft (any computer), or on a Mac use the Calendar and
 * Mail apps with every account the Mac already has.
 */
export function ConnectApps({ onClose, onTry }: { onClose(): void; onTry(prompt: string): void }) {
  const mac = hob.platform === 'darwin'
  const access = useMacAccess()
  const [accounts, setAccounts] = useState<AccountsState | null>(null)
  const [asking, setAsking] = useState(false)
  const [signingIn, setSigningIn] = useState<'google' | 'microsoft' | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    void hob.accounts.get().then(setAccounts)
    return hob.accounts.onChanged(setAccounts)
  }, [])
  const ask = async () => {
    setError(''); setAsking(true)
    try { await hob.mac.ask() } catch (err) { setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err)) } finally { setAsking(false) }
  }
  const signIn = async (p: 'google' | 'microsoft') => {
    setError(''); setSigningIn(p)
    try { setAccounts(await hob.accounts.signIn(p)) } catch (err) { setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err)) } finally { setSigningIn(null) }
  }
  const account = accounts?.current
  const done = !!account || connected(access)
  const denied = access && (access.calendar === 'denied' || access.mail === 'denied')
  const providers = accounts?.available ?? []
  const row = (Icon: typeof Mail, label: string, status?: string) => (
    <li className="flex items-center gap-2.5 text-ui">
      <Icon size={16} strokeWidth={1.75} className="text-ink-soft" />
      <span className="flex-1">{label}</span>
      {status === 'granted'
        ? <span className="inline-flex items-center gap-1 font-medium"><Check size={14} className="text-emerald-600 dark:text-emerald-400" />{t('Connected')}</span>
        : status === 'denied' ? <span className="text-accent">{t('Not allowed')}</span>
        : <span className="inline-flex items-center gap-1 text-muted"><Circle size={10} />{t('Not yet')}</span>}
    </li>
  )
  const signInButtons = providers.length > 0 && !account && (
    <div className="space-y-2">
      {providers.map((p) => (
        <button key={p} data-testid={`account-signin-${p}`} disabled={!!signingIn} onClick={() => void signIn(p)}
          className="flex w-full items-center justify-center gap-2.5 rounded-control border border-line-strong bg-surface px-3 py-2 text-ui font-medium hover:bg-line/40 disabled:opacity-60">
          {p === 'google' ? <GoogleMark /> : <MicrosoftMark />}
          {signingIn === p ? t('Finish signing in in your browser…') : t('Continue with {name}', { name: NAMES[p] })}
        </button>
      ))}
      {signingIn && <button className="w-full text-meta text-muted underline underline-offset-2 hover:text-ink" onClick={() => void hob.accounts.cancel()}>{t('Cancel')}</button>}
    </div>
  )
  return (
    <Dialog title={done ? t('Email and calendar connected') : t('Connect your email and calendar')} onClose={onClose} testId="connect-apps">
      {done && <div role="status" className="mb-4 flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-600/10 text-emerald-600 dark:text-emerald-400"><Check size={22} strokeWidth={2} aria-hidden="true" /></span>
        <p className="text-ui text-ink-soft">{t('Connected. Hob can use it in your next message.')}</p>
      </div>}
      {account ? (
        <div data-testid="account-connected" className="flex items-center gap-3 rounded-card border border-line px-4 py-3 text-ui">
          {account.provider === 'google' ? <GoogleMark /> : <MicrosoftMark />}
          <span className="min-w-0 flex-1"><span className="block font-medium">{t('Connected to {name}', { name: NAMES[account.provider] })}</span><span className="block truncate text-meta text-ink-soft">{account.email}</span></span>
          <button data-testid="account-signout" className="text-meta text-ink-soft underline underline-offset-2 hover:text-ink" onClick={() => void hob.accounts.signOut().then(setAccounts)}>{t('Sign out')}</button>
        </div>
      ) : mac ? (
        <>
          {!done && <p className="text-ui text-ink-soft">{t('Hob can use the Calendar and Mail apps on this Mac, with every account you added there: iCloud, Google, Outlook and more.')}</p>}
          <ul className={`${done ? '' : 'mt-4'} space-y-2.5 rounded-card border border-line px-4 py-3`}>
            {row(Calendar, t('Calendar'), access?.calendar)}
            {row(Mail, t('Mail'), access?.mail)}
          </ul>
          {denied && <p className="mt-3 text-ui text-ink-soft">{t('To change it, allow Hob in System Settings → Privacy & Security → Calendars and → Automation.')}</p>}
          {providers.length > 0 && !connected(access) && (
            <>
              <p className="mb-3 mt-5 text-ui text-ink-soft">{t('Or sign in to your Google or Microsoft account instead:')}</p>
              {signInButtons}
            </>
          )}
        </>
      ) : providers.length > 0 ? (
        <>
          <p className="mb-4 text-ui text-ink-soft">{t('Sign in to the account with your email and calendar. Gmail and Google Calendar, or Outlook, Hotmail and Microsoft 365.')}</p>
          {signInButtons}
        </>
      ) : (
        <p className="text-ui text-ink-soft">{t("Connecting email and calendar isn't available in this version of Hob yet.")}</p>
      )}
      {error && <p data-testid="account-error" className="mt-3 text-ui text-accent">{error}</p>}
      <p className="mt-4 text-meta text-muted">
        {account || !mac ? t('Your email and calendar go straight from your account to this computer, never to anyone else.') : t('Nothing leaves your computer.')}{' '}
        {t('Hob only writes email drafts: you send them.')}
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button className={button.quiet} onClick={onClose}>{done ? t('Done') : t('Not now')}</button>
        {done
          ? <button data-testid="connect-apps-try" className={button.primary} onClick={() => onTry(t("What's on my calendar this week?"))}>{t('Try in chat')}</button>
          : mac && <button data-testid="connect-apps-allow" className={button.primary} disabled={asking} onClick={() => void ask()}>{asking ? t('Waiting for your Mac…') : t('Allow access')}</button>}
      </div>
    </Dialog>
  )
}
