import { createHash, randomBytes } from 'node:crypto'
import { BrowserWindow, session } from 'electron'
import { fetchWithTimeout } from '../net'
import { log, registerSecret } from '../logger'

/**
 * Konto Xbox (etap 19c, decyzja użytkownika 2026-11-16: własna rejestracja aplikacji w Azure): logowanie kontem
 * Microsoft na stronie Microsoft w osobnym oknie (Lumen nie widzi hasła), kod z PKCE → tokeny Microsoft → Xbox Live
 * (XBL → XSTS) → historia tytułów konta (titlehub). Zapisany jest tylko token odświeżania — zaszyfrowany jak inne sekrety.
 */
export const REDIRECT = 'https://login.microsoftonline.com/common/oauth2/nativeclient'
const AUTHORIZE = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize'
const TOKEN = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token'
const SCOPE = 'XboxLive.signin offline_access'
const PARTITION = 'persist:xbox-login'

const b64url = (b: Buffer): string => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export interface MsTokens {
  access: string
  refresh: string
}

export interface XblIdentity {
  uhs: string
  xuid: string
  gamertag: string
  token: string
}

/** adres strony logowania i weryfikator PKCE */
export function authorizeUrl(clientId: string): { url: string; verifier: string; state: string } {
  const verifier = b64url(randomBytes(48))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const state = b64url(randomBytes(16))
  const q = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: REDIRECT,
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    prompt: 'select_account'
  })
  return { url: `${AUTHORIZE}?${q}`, verifier, state }
}

/** adres powrotu → kod albo błąd (null — to jeszcze nie powrót) */
export function redirectResult(url: string, state: string): { code?: string; error?: string } | null {
  if (!url.startsWith(REDIRECT)) return null
  const q = new URL(url).searchParams
  if (q.get('error')) return { error: q.get('error_description') || q.get('error') || 'odmowa' }
  if (q.get('state') !== state) return { error: 'niezgodny parametr state' }
  const code = q.get('code')
  return code ? { code } : { error: 'brak kodu logowania' }
}

async function tokenCall(body: Record<string, string>): Promise<MsTokens> {
  const r = await fetchWithTimeout(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() }, 30_000)
  const d = (await r.json()) as { access_token?: string; refresh_token?: string }
  if (!d.access_token || !d.refresh_token) throw new Error('Microsoft nie zwrócił tokenów')
  registerSecret(d.access_token)
  registerSecret(d.refresh_token)
  return { access: d.access_token, refresh: d.refresh_token }
}

export const exchangeCode = (clientId: string, code: string, verifier: string): Promise<MsTokens> =>
  tokenCall({ client_id: clientId, grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: verifier, scope: SCOPE })

export const refreshTokens = (clientId: string, refresh: string): Promise<MsTokens> =>
  tokenCall({ client_id: clientId, grant_type: 'refresh_token', refresh_token: refresh, scope: SCOPE })

/** token Microsoft → tożsamość Xbox Live (uhs, xuid, gamertag, token XSTS dla xboxlive.com) */
export async function xblIdentity(access: string): Promise<XblIdentity> {
  const json = { 'Content-Type': 'application/json', Accept: 'application/json', 'x-xbl-contract-version': '1' }
  const u = await fetchWithTimeout(
    'https://user.auth.xboxlive.com/user/authenticate',
    {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${access}` }, RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT' })
    },
    30_000
  )
  const user = (await u.json()) as { Token?: string }
  if (!user.Token) throw new Error('Xbox Live nie przyjął logowania')
  const x = await fetchWithTimeout(
    'https://xsts.auth.xboxlive.com/xsts/authorize',
    { method: 'POST', headers: json, body: JSON.stringify({ Properties: { SandboxId: 'RETAIL', UserTokens: [user.Token] }, RelyingParty: 'http://xboxlive.com', TokenType: 'JWT' }) },
    30_000
  )
  const xsts = (await x.json()) as { Token?: string; DisplayClaims?: { xui?: { uhs?: string; xid?: string; gtg?: string }[] } }
  const c = xsts.DisplayClaims?.xui?.[0]
  if (!xsts.Token || !c?.uhs || !c.xid) throw new Error('Xbox Live nie wydał tokenu (konto bez profilu Xbox?)')
  registerSecret(xsts.Token)
  return { uhs: c.uhs, xuid: c.xid, gamertag: c.gtg ?? '', token: xsts.Token }
}

export interface AccountTitle {
  storeId?: string
  pfn?: string
  name: string
}

/** historia tytułów konta → gry na PC (StoreId z dostępności, rodzina pakietu) */
export function parseTitles(json: unknown): AccountTitle[] {
  const titles = (json as { titles?: unknown[] })?.titles
  if (!Array.isArray(titles)) return []
  const out: AccountTitle[] = []
  for (const t of titles as Record<string, unknown>[]) {
    if (t?.type && t.type !== 'Game') continue
    const devices = Array.isArray(t.devices) ? (t.devices as string[]) : []
    if (devices.length && !devices.some((d) => /^(PC|Win32)$/i.test(d))) continue
    const detail = (t.detail ?? {}) as { availabilities?: { ProductId?: string }[] }
    const pid = String(t.productId ?? detail.availabilities?.find((a) => a?.ProductId)?.ProductId ?? '').toUpperCase()
    const pfn = typeof t.pfn === 'string' ? t.pfn : undefined
    out.push({ ...(/^[0-9A-Z]{12}$/.test(pid) ? { storeId: pid } : {}), ...(pfn ? { pfn } : {}), name: String(t.name ?? '') })
  }
  return out
}

export async function accountTitles(id: XblIdentity): Promise<AccountTitle[]> {
  const r = await fetchWithTimeout(
    `https://titlehub.xboxlive.com/users/xuid(${id.xuid})/titles/titlehistory/decoration/detail?maxItems=2000`,
    { headers: { Authorization: `XBL3.0 x=${id.uhs};${id.token}`, 'x-xbl-contract-version': '2', 'Accept-Language': 'pl-PL', Accept: 'application/json' } },
    60_000
  )
  return parseTitles(await r.json())
}

/** Strona logowania Microsoft w osobnym oknie; kończy się kodem (wymiana na tokeny) albo zamknięciem okna. */
export function loginWindow(parent: BrowserWindow | null, clientId: string): Promise<MsTokens> {
  const { url, verifier, state } = authorizeUrl(clientId)
  return new Promise((resolve, reject) => {
    const w = new BrowserWindow({
      width: 520,
      height: 720,
      ...(parent ? { parent } : {}),
      alwaysOnTop: true,
      autoHideMenuBar: true,
      title: 'Logowanie do Xbox (konto Microsoft)',
      webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    let done = false
    const finish = (r: { code?: string; error?: string }): void => {
      if (done) return
      done = true
      if (!w.isDestroyed()) w.close()
      if (!r.code) return reject(new Error(r.error ?? 'Logowanie przerwane'))
      exchangeCode(clientId, r.code, verifier).then(resolve, reject)
    }
    const check = (e: Electron.Event, target: string): void => {
      const r = redirectResult(target, state)
      if (!r) return
      e.preventDefault()
      finish(r)
    }
    w.webContents.on('will-redirect', (e, target) => check(e, target))
    w.webContents.on('will-navigate', (e, target) => check(e, target))
    w.on('closed', () => finish({ error: 'Okno logowania zamknięte' }))
    void w.loadURL(url).catch((e: Error) => log.warn('xbox', `logowanie: ${e.message}`))
  })
}

export async function clearLoginSession(): Promise<void> {
  await session.fromPartition(PARTITION).clearStorageData()
}
