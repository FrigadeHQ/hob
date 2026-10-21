/**
 * Google and Microsoft sign-in. The client IDs come from Garth's app registrations (Google Cloud Console:
 * OAuth client of type "Desktop app"; Microsoft Entra: app registration with the "Mobile and desktop
 * applications" platform and redirect http://localhost). A desktop app can't keep a secret, so these are not
 * secrets: Google's "client secret" for desktop apps is public by design, and PKCE protects each sign-in.
 * A provider without a client ID isn't offered.
 */
export const GOOGLE_CLIENT_ID = ''
export const GOOGLE_CLIENT_SECRET = ''
export const MICROSOFT_CLIENT_ID = ''

export type ProviderId = 'google' | 'microsoft'
export type Provider = {
  id: ProviderId
  name: string
  authUrl: string
  tokenUrl: string
  scopes: string[]
  clientId: string
  clientSecret?: string
  /** the loopback host in the redirect: Google wants 127.0.0.1, Microsoft localhost */
  host: '127.0.0.1' | 'localhost'
  extra: Record<string, string>
}

export const PROVIDERS: Record<ProviderId, Provider> = {
  google: {
    id: 'google', name: 'Google',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['openid', 'email', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly', 'https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.compose'],
    clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET || undefined, host: '127.0.0.1',
    // a refresh token, so the user stays signed in
    extra: { access_type: 'offline', prompt: 'consent' },
  },
  microsoft: {
    id: 'microsoft', name: 'Microsoft',
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['openid', 'email', 'offline_access', 'User.Read', 'Calendars.ReadWrite', 'Mail.ReadWrite'],
    clientId: MICROSOFT_CLIENT_ID, host: 'localhost',
    extra: { prompt: 'select_account' },
  },
}
