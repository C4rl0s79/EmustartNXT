import { EventEmitter } from 'node:events'
import { BrowserWindow, session } from 'electron'
import type { SteamFamilyStatus } from '@shared/types'
import { fetchWithTimeout } from '../net'
import { log, registerSecret } from '../logger'
import { JsonFile } from '../store/jsonFile'

// Steam Family Sharing: games lent by the family group. The Web API key is refused here (401) — these
// IFamilyGroupsService methods take the access token of a logged-in Steam session. The player signs in once
// on Steam's own page in a separate window; Lumen never sees the password and keeps only that session (its own
// partition). The list is kept on disk, so the library works offline.

const PARTITION = 'persist:steam-family'
const CONFIG = 'https://store.steampowered.com/pointssummary/ajaxgetasyncconfig'
const LOGIN = 'https://store.steampowered.com/login/'
const API = 'https://api.steampowered.com/IFamilyGroupsService'
const TTL_MS = 6 * 3600 * 1000

export interface FamilyGame {
  appId: number
  name: string
}

interface Cache {
  steamId: string
  fetchedAt: number
  games: FamilyGame[]
}

/** GetSharedLibraryApps → games that can really be played: excluded titles (exclude_reason) are left out */
export function parseFamilyApps(json: unknown): FamilyGame[] {
  const apps = (json as { response?: { apps?: unknown } })?.response?.apps
  if (!Array.isArray(apps)) return []
  const out: FamilyGame[] = []
  for (const a of apps as { appid?: unknown; name?: unknown; exclude_reason?: unknown }[]) {
    if (typeof a?.appid !== 'number' || a.exclude_reason) continue
    out.push({ appId: a.appid, name: typeof a.name === 'string' ? a.name : '' })
  }
  return out
}

export class SteamFamily extends EventEmitter {
  private cache: JsonFile<Cache>
  private data: Cache = { steamId: '', fetchedAt: 0, games: [] }
  private loggedIn = false
  private error = ''
  private busy: Promise<void> | null = null

  constructor(file: string) {
    super()
    this.cache = new JsonFile<Cache>(file, () => ({ steamId: '', fetchedAt: 0, games: [] }))
  }

  async init(): Promise<void> {
    this.data = await this.cache.load()
  }

  games(steamId: string | undefined): FamilyGame[] {
    return steamId && this.data.steamId === steamId ? this.data.games : []
  }

  get status(): SteamFamilyStatus {
    return { loggedIn: this.loggedIn, count: this.data.games.length, fetchedAt: this.data.fetchedAt, error: this.error || undefined }
  }

  private async token(): Promise<string> {
    const res = await session.fromPartition(PARTITION).fetch(CONFIG, { credentials: 'include' })
    if (!res.ok) return ''
    const j = (await res.json()) as { data?: { webapi_token?: unknown } }
    const t = typeof j?.data?.webapi_token === 'string' ? j.data.webapi_token : ''
    if (t) registerSecret(t)
    return t
  }

  private async api(method: string, token: string, params: Record<string, string>): Promise<unknown> {
    const q = new URLSearchParams({ access_token: token, ...params })
    const res = await fetchWithTimeout(`${API}/${method}/v1/?${q}`, {}, 20000)
    if (!res.ok) throw new Error(`Steam: HTTP ${res.status}`)
    return res.json()
  }

  refresh(steamId: string | undefined, force = false): Promise<void> {
    if (this.busy) return this.busy
    this.busy = this.fetch(steamId, force).finally(() => {
      this.busy = null
      this.emit('change')
    })
    return this.busy
  }

  private async fetch(steamId: string | undefined, force: boolean): Promise<void> {
    if (!steamId) return
    try {
      const token = await this.token()
      this.loggedIn = !!token
      this.error = ''
      if (!token) return
      if (!force && this.data.steamId === steamId && Date.now() - this.data.fetchedAt < TTL_MS) return
      const fam = (await this.api('GetFamilyGroupForUser', token, { steamid: steamId })) as { response?: { family_groupid?: unknown } }
      const group = String(fam?.response?.family_groupid ?? '')
      let games: FamilyGame[] = []
      if (group && group !== '0') {
        games = parseFamilyApps(
          await this.api('GetSharedLibraryApps', token, {
            family_groupid: group,
            steamid: steamId,
            include_own: 'false',
            include_excluded: 'false',
            include_free: 'false',
            include_non_games: 'false'
          })
        )
      }
      this.data = { steamId, fetchedAt: Date.now(), games }
      await this.cache.save(this.data)
      log.info('library', `family library: ${games.length} games`)
    } catch (e) {
      this.error = 'Nie udało się pobrać biblioteki rodzinnej. Pokazuję ostatnie dane.'
      log.warn('library', `family library: ${(e as Error).message}`)
    }
  }

  /** Steam's own login page in a separate window; ends when the session works or the window is closed. */
  login(parent: BrowserWindow | null, steamId: string | undefined): Promise<SteamFamilyStatus> {
    return new Promise((resolve) => {
      const w = new BrowserWindow({
        width: 900,
        height: 760,
        ...(parent ? { parent } : {}),
        alwaysOnTop: true,
        autoHideMenuBar: true,
        title: 'Logowanie do Steam',
        webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false }
      })
      let done = false
      const finish = async (): Promise<void> => {
        if (done) return
        done = true
        clearInterval(timer)
        if (!w.isDestroyed()) w.close()
        await this.refresh(steamId, true)
        resolve(this.status)
      }
      const timer = setInterval(() => {
        void this.token()
          .then((t) => (t ? finish() : undefined))
          .catch(() => undefined)
      }, 2000)
      w.on('closed', () => void finish())
      void w.loadURL(LOGIN)
    })
  }

  async logout(): Promise<SteamFamilyStatus> {
    await session.fromPartition(PARTITION).clearStorageData()
    this.loggedIn = false
    this.error = ''
    this.data = { steamId: '', fetchedAt: 0, games: [] }
    await this.cache.save(this.data)
    this.emit('change')
    return this.status
  }
}
