import { createHash, randomBytes } from 'node:crypto'
import { BrowserWindow, session } from 'electron'
import { fetchWithTimeout } from '../net'
import { log, registerSecret } from '../logger'
import { isStoreId } from './catalog'

/**
 * Konto Xbox (etap 19c): logowanie kontem Microsoft na stronie Microsoft w osobnym oknie (Lumen nie widzi hasła) →
 * tokeny Microsoft → Xbox Live (XBL → XSTS) → historia tytułów konta (titlehub). Zapisany jest tylko token odświeżania
 * — zaszyfrowany jak inne sekrety. Dwa sposoby (decyzja użytkownika 2026-11-16, bez Azure):
 *  • domyślnie — publiczny identyfikator aplikacji Xbox od Microsoft (login.live.com, bez rejestracji; Microsoft może
 *    go kiedyś wyłączyć dla programów zewnętrznych),
 *  • własna aplikacja Azure gracza (Ustawienia → Xbox → identyfikator) — login.microsoftonline.com, PKCE.
 * Każdy loguje się własnym kontem; identyfikator oznacza program, nie osobę.
 */
export const XBOX_PUBLIC_CLIENT = '0000000048093EE3'
const PARTITION = 'persist:xbox-login'

interface Flow {
  clientId: string
  authorize: string
  token: string
  redirect: string
  scope: string
  /** przedrostek biletu RPS dla user.auth.xboxlive.com: „t=” (login.live.com), „d=” (Azure) */
  rps: 't=' | 'd='
  pkce: boolean
}

/** sposób logowania: własna aplikacja Azure albo publiczny identyfikator Xbox */
export function flowFor(clientId?: string): Flow {
  if (clientId)
    return {
      clientId,
      authorize: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize',
      token: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
      redirect: 'https://login.microsoftonline.com/common/oauth2/nativeclient',
      scope: 'XboxLive.signin offline_access',
      rps: 'd=',
      pkce: true
    }
  return {
    clientId: XBOX_PUBLIC_CLIENT,
    authorize: 'https://login.live.com/oauth20_authorize.srf',
    token: 'https://login.live.com/oauth20_token.srf',
    redirect: 'https://login.live.com/oauth20_desktop.srf',
    scope: 'service::user.auth.xboxlive.com::MBI_SSL',
    rps: 't=',
    pkce: false
  }
}

/** zapisane logowanie: „<identyfikator>|<token odświeżania>” — zmiana identyfikatora wymaga ponownego logowania */
export function packLogin(clientId: string, refresh: string): string {
  return `${clientId}|${refresh}`
}

export function unpackLogin(stored: string | undefined): { clientId: string; refresh: string } | null {
  const i = stored?.indexOf('|') ?? -1
  if (!stored || i <= 0) return null
  return { clientId: stored.slice(0, i), refresh: stored.slice(i + 1) }
}

/** dawny adres powrotu (testy, porównania) */
export const REDIRECT = flowFor('x').redirect

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

/** adres strony logowania i weryfikator PKCE (bez Azure — bez PKCE, jak aplikacja Xbox) */
export function authorizeUrl(clientId: string | Flow): { url: string; verifier: string; state: string } {
  const f = typeof clientId === 'string' ? flowFor(clientId) : clientId
  const verifier = b64url(randomBytes(48))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const state = b64url(randomBytes(16))
  const q = new URLSearchParams({
    client_id: f.clientId,
    response_type: 'code',
    redirect_uri: f.redirect,
    scope: f.scope,
    ...(f.pkce ? { code_challenge: challenge, code_challenge_method: 'S256' } : {}),
    state,
    prompt: 'select_account'
  })
  return { url: `${f.authorize}?${q}`, verifier, state }
}

/** adres powrotu → kod albo błąd (null — to jeszcze nie powrót) */
export function redirectResult(url: string, state: string, redirect: string = REDIRECT): { code?: string; error?: string } | null {
  if (!url.startsWith(redirect)) return null
  const q = new URL(url).searchParams
  if (q.get('error')) return { error: q.get('error_description') || q.get('error') || 'odmowa' }
  if (q.get('state') !== state) return { error: 'niezgodny parametr state' }
  const code = q.get('code')
  return code ? { code } : { error: 'brak kodu logowania' }
}

async function tokenCall(url: string, body: Record<string, string>): Promise<MsTokens> {
  const r = await fetchWithTimeout(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() }, 30_000)
  const d = (await r.json()) as { access_token?: string; refresh_token?: string }
  if (!d.access_token || !d.refresh_token) throw new Error('Microsoft nie zwrócił tokenów')
  registerSecret(d.access_token)
  registerSecret(d.refresh_token)
  return { access: d.access_token, refresh: d.refresh_token }
}

export const exchangeCode = (f: Flow, code: string, verifier: string): Promise<MsTokens> =>
  tokenCall(f.token, {
    client_id: f.clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: f.redirect,
    scope: f.scope,
    ...(f.pkce ? { code_verifier: verifier } : {})
  })

export const refreshTokens = (f: Flow, refresh: string): Promise<MsTokens> =>
  tokenCall(f.token, { client_id: f.clientId, grant_type: 'refresh_token', refresh_token: refresh, scope: f.scope, ...(f.pkce ? {} : { redirect_uri: f.redirect }) })

/** kody odmowy Xbox Live (nagłówek / pole XErr) → przyczyna po polsku */
const XERR: Record<string, string> = {
  '2148916227': 'konto zablokowane w Xbox',
  '2148916229': 'konto dziecka bez zgody rodzica na Xbox Live',
  '2148916233': 'konto Microsoft nie ma profilu Xbox — załóż go raz na xbox.com',
  '2148916234': 'trzeba zaakceptować warunki Xbox na xbox.com',
  '2148916235': 'Xbox Live jest niedostępny w kraju konta',
  '2148916236': 'konto wymaga weryfikacji wieku na xbox.com',
  '2148916237': 'limit czasu gry na koncie dziecka',
  '2148916238': 'konto dziecka (poniżej 18 lat) — trzeba dodać je do rodziny Microsoft'
}

export function xerrText(code: string | null | undefined): string {
  const c = String(code ?? '').trim()
  return c ? (XERR[c] ?? `kod Xbox ${c}`) : ''
}

/** POST JSON do Xbox Live — przy odmowie błąd z kodem XErr (nagłówek x-err albo pole XErr), nie sam status HTTP.
 *  Własny limit czasu zamiast fetchWithTimeout: tamta funkcja przy odmowie rzuca wyjątek bez nagłówków odpowiedzi. */
async function xblPost(url: string, body: unknown): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; status: number; xerr: string }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 30_000)
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-xbl-contract-version': '1' },
      body: JSON.stringify(body),
      signal: ctrl.signal
    })
    const text = await r.text()
    let data: Record<string, unknown> = {}
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {}
    } catch {
      /* odpowiedź bez JSON (np. 403 z pustą treścią) */
    }
    if (r.ok) return { ok: true, data }
    return { ok: false, status: r.status, xerr: String(r.headers.get('x-err') ?? data.XErr ?? '') }
  } finally {
    clearTimeout(timer)
  }
}

/** formy biletu RPS do sprawdzenia: najpierw ta ze sposobu logowania, potem pozostałe (źródła nie są zgodne) */
export function rpsCandidates(access: string, rps: Flow['rps']): string[] {
  const all = [`${rps}${access}`, `${rps === 't=' ? 'd=' : 't='}${access}`, access]
  return [...new Set(all)]
}

/** token Microsoft → tożsamość Xbox Live (uhs, xuid, gamertag, token XSTS dla xboxlive.com) */
export async function xblIdentity(access: string, rps: Flow['rps'] = 'd='): Promise<XblIdentity> {
  let userToken = ''
  let last = ''
  for (const ticket of rpsCandidates(access, rps)) {
    const r = await xblPost('https://user.auth.xboxlive.com/user/authenticate', {
      Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: ticket },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT'
    })
    if (r.ok && typeof r.data.Token === 'string') {
      userToken = r.data.Token
      log.info('xbox', `bilet RPS przyjęty (${ticket === access ? 'bez przedrostka' : ticket.slice(0, 2)})`)
      break
    }
    if (!r.ok) {
      last = `HTTP ${r.status}${r.xerr ? `, ${xerrText(r.xerr)}` : ''}`
      log.warn('xbox', `user.auth (${ticket === access ? 'bez przedrostka' : ticket.slice(0, 2)}): ${last}`)
      if (r.status >= 500) break
    }
  }
  if (!userToken) throw new Error(`Xbox Live nie przyjął logowania (${last || 'brak tokenu'})`)
  const x = await xblPost('https://xsts.auth.xboxlive.com/xsts/authorize', {
    Properties: { SandboxId: 'RETAIL', UserTokens: [userToken] },
    RelyingParty: 'http://xboxlive.com',
    TokenType: 'JWT'
  })
  if (!x.ok) {
    const why = xerrText(x.xerr)
    log.warn('xbox', `xsts: HTTP ${x.status}${why ? `, ${why}` : ''}`)
    throw new Error(`Xbox Live nie wydał tokenu (${why || `HTTP ${x.status}`})`)
  }
  const xsts = x.data as { Token?: string; DisplayClaims?: { xui?: { uhs?: string; xid?: string; gtg?: string }[] } }
  const c = xsts.DisplayClaims?.xui?.[0]
  if (!xsts.Token || !c?.uhs || !c.xid) throw new Error('Xbox Live nie wydał tokenu (konto bez profilu Xbox?)')
  registerSecret(userToken)
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
    out.push({ ...(isStoreId(pid) ? { storeId: pid } : {}), ...(pfn ? { pfn } : {}), name: String(t.name ?? '') })
  }
  return out
}

export async function accountTitles(id: XblIdentity): Promise<AccountTitle[]> {
  const r = await fetchWithTimeout(
    `https://titlehub.xboxlive.com/users/xuid(${id.xuid})/titles/titlehistory/decoration/detail?maxItems=2000`,
    { headers: { Authorization: `XBL3.0 x=${id.uhs};${id.token}`, 'x-xbl-contract-version': '2', 'Accept-Language': 'pl-PL', Accept: 'application/json' } },
    60_000
  )
  const d = (await r.json()) as { titles?: unknown }
  // odpowiedź bez listy tytułów to błąd — nie „konto bez gier” (lista z konta zostaje; przegląd kodu)
  if (!Array.isArray(d?.titles)) throw new Error('historia tytułów Xbox: zła odpowiedź')
  return parseTitles(d)
}

/** Strona logowania Microsoft w osobnym oknie; kończy się kodem (wymiana na tokeny) albo zamknięciem okna. */
export function loginWindow(parent: BrowserWindow | null, f: Flow): Promise<MsTokens> {
  const { url, verifier, state } = authorizeUrl(f)
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
      exchangeCode(f, r.code, verifier).then(resolve, reject)
    }
    const check = (e: Electron.Event, target: string): void => {
      const r = redirectResult(target, state, f.redirect)
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
