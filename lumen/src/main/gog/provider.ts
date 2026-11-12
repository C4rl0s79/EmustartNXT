import { EventEmitter } from 'node:events'
import type { Game, GogGameInfo, GogInstallState, GogSummary, Job } from '@shared/types'
import { isElevated } from '../elevation'
import { log } from '../logger'
import { JsonFile } from '../store/jsonFile'
import type { EmustartEngine } from '../emustart/engine'

// GOG games from the EmuStart server's depot archive. Everything runs in the EmuStart engine (the same
// process as emulated games — engine/emustart/goglib.py): catalog from the server with an offline copy,
// installs, jobs, launch. Lumen maps it to its library and job list. Game.id = gog:<productId>.

/** gog_library (engine) */
export interface GogLibraryRaw {
  games: { product_id: string; title: string; slug?: string; local_only?: boolean; builds: GogBuildRaw[]; info?: GogInfoRaw }[]
  installs: Record<string, GogInstallRaw>
  fresh: boolean
  error?: string
}

/** description and art of a game from GOG Manager's game folder on the server (EmuStart gogmeta) */
export interface GogInfoRaw {
  description?: string
  lead?: string
  release?: string
  developers?: string[]
  publishers?: string[]
  tags?: string[]
  /** art kinds the server has: grid (box art), hero (background), logo, icon */
  art?: string[]
  extras?: { id: string; file?: string; name: string; type: string; size: number; default: boolean }[]
}

export interface GogBuildRaw {
  build_id: string
  version: string
  languages: string[]
  dlcs: { id: string; name: string; has_files: boolean }[]
  dependencies: string[]
  size: number
  compressed_size?: number
  hash: string
  install_directory?: string
}

export interface GogInstallRaw {
  product_id: string
  title: string
  state: string
  build_id?: string
  version?: string
  hash?: string
  install_dir?: string
  languages?: string[]
  primary?: string
  dlcs?: string[]
  error?: string
  admin_steps?: number
  runtimes?: { id: string; done: boolean }[]
  skipped?: string[]
  admin_failed?: number
  pending_dlc?: string[]
  installed_at?: number
  last_played?: number
  running?: boolean
}

/** gog_status (engine) */
export interface GogStatusRaw {
  jobs: { product_id: string; kind: string; title: string; phase: string; label: string; done: number; total: number; speed: number; active: boolean; cancellable: boolean }[]
  last: Record<string, { ok: boolean; message: string; at: number }>
  running: string[]
}

const EMPTY: GogLibraryRaw = { games: [], installs: {}, fresh: false }
const POLL_MS = 1500
/** the server's catalog grows while it indexes the archive / GOG Manager adds games — ask again now and then */
const CATALOG_MS = 5 * 60_000

export const gogId = (pid: string): string => `gog:${pid}`
export const isGogId = (id: string): boolean => /^gog:\d{1,20}$/.test(id)
export const gogPid = (id: string): string | undefined => (isGogId(id) ? id.slice(4) : undefined)

const STATES: GogInstallState[] = ['notInstalled', 'installing', 'installed', 'needs_admin', 'failed', 'cancelled', 'damaged']

/** Library rows → Lumen games. A game with a job in progress shows as installing. */
export function gogGames(lib: GogLibraryRaw, st: GogStatusRaw | null): Game[] {
  const jobs = new Set((st?.jobs ?? []).map((j) => j.product_id))
  const running = new Set(st?.running ?? [])
  return lib.games.map((g) => {
    const inst = lib.installs[g.product_id]
    const b = g.builds[0]
    let state: GogInstallState = inst && STATES.includes(inst.state as GogInstallState) ? (inst.state as GogInstallState) : 'notInstalled'
    if (jobs.has(g.product_id) && state !== 'installed' && state !== 'needs_admin') state = 'installing'
    const installed = state === 'installed'
    const info: GogGameInfo = {
      productId: g.product_id,
      state,
      onServer: !g.local_only && !!b,
      ...(g.info?.extras?.length ? { extras: g.info.extras.map((x) => ({ id: x.id, name: x.name, type: x.type, size: x.size, default: x.default })) } : {}),
      ...(b ? { available: { buildId: b.build_id, version: b.version, languages: b.languages, dlcs: b.dlcs.map((d) => ({ id: d.id, name: d.name, hasFiles: d.has_files })), size: b.size } } : {}),
      ...(inst
        ? {
            buildId: inst.build_id,
            version: inst.version,
            installDir: inst.install_dir,
            languages: inst.languages,
            primary: inst.primary,
            dlcs: inst.dlcs,
            error: inst.error || undefined,
            adminSteps: inst.admin_steps,
            runtimes: inst.runtimes,
            skipped: inst.skipped?.length ? inst.skipped : undefined,
            adminFailed: inst.admin_failed || undefined,
            pendingDlc: inst.pending_dlc?.length ? inst.pending_dlc : undefined,
            updateNote: b && inst.hash && b.hash !== inst.hash ? 'Serwer ma nowszy build tej gry. Aktualizacja zainstalowanej gry nie jest jeszcze obsługiwana.' : undefined
          }
        : {})
    }
    const name = inst?.title || g.title
    return {
      id: gogId(g.product_id),
      source: 'gog',
      appId: 0,
      name,
      sortName: name.toLocaleLowerCase('pl'),
      provenance: ['emustartGog'],
      installState: installed ? 'installed' : state === 'installing' ? 'installing' : state === 'notInstalled' ? 'notInstalled' : 'broken',
      installed,
      installDir: inst?.install_dir,
      sizeOnDisk: b?.size,
      buildId: inst?.build_id ?? b?.build_id,
      lastPlayed: inst?.last_played ? Math.round(inst.last_played) : undefined,
      addedAt: inst?.installed_at ? Math.round(inst.installed_at) : undefined,
      running: running.has(g.product_id),
      gog: info
    } satisfies Game
  })
}

export function gogJobs(st: GogStatusRaw | null): Job[] {
  if (!st) return []
  return st.jobs.map((j) => ({
    id: `gog:${j.product_id}:${j.kind}`,
    kind: 'gogInstall',
    source: 'gog',
    gameId: gogId(j.product_id),
    title: j.title,
    phase: j.kind === 'extras' ? `Dodatki — ${j.label}` : j.kind === 'dlc' ? `DLC — ${j.label}` : j.kind === 'repair' ? `Naprawa — ${j.label}` : j.label,
    state: j.active ? 'active' : 'queued',
    progress: j.total > 0 ? { done: j.done, total: j.total, speed: j.speed || undefined, eta: j.speed > 0 ? Math.max(0, j.total - j.done) / j.speed : undefined } : undefined,
    cancellable: j.cancellable
  }))
}

export class GogProvider extends EventEmitter {
  private lib: GogLibraryRaw = EMPTY
  private status: GogStatusRaw | null = null
  private games: Game[] = []
  private fromCache = true
  private timer: NodeJS.Timeout | undefined
  private cache: JsonFile<GogLibraryRaw>
  private lastMsgAt = 0
  private lastCatalog = 0

  constructor(private readonly engine: EmustartEngine, cacheFile: string) {
    super()
    this.cache = new JsonFile<GogLibraryRaw>(cacheFile, () => EMPTY)
    engine.on('state', (s) => {
      if (s === 'ready') {
        void this.refresh(true)
        this.startPolling()
        if (isElevated()) void this.finishPendingAdmin()
      } else {
        this.stopPolling()
        this.status = null
        this.apply()
      }
    })
  }

  /** Lumen jako administrator: zaległe kroki instalacji gier (rejestr GOG, biblioteki, kroki skryptów) i niecofnięte
   *  kroki gier odinstalowanych — od razu przy starcie, bez okna UAC (silnik ma uprawnienia). */
  private async finishPendingAdmin(): Promise<void> {
    try {
      const p = await this.engine.call<{ games?: string[]; undo?: number }>('gog_admin_pending', [])
      if (!p.games?.length && !p.undo) return
      const r = await this.engine.call<{ ok: boolean; message?: string; reason?: string }>('gog_finish_admin_all', [], 10 * 60_000)
      log.info('gog', `zaległe kroki administratora: ${r.ok ? r.message ?? 'OK' : r.reason ?? 'nie wykonano'}`)
      void this.refresh(false)
    } catch (e) {
      log.warn('gog', `zaległe kroki administratora: ${(e as Error).message}`)
    }
  }

  async init(): Promise<void> {
    const c = await this.cache.load()
    if (c.games.length && !this.lib.games.length) {
      this.lib = c
      this.apply()
    }
  }

  get currentGames(): Game[] {
    return this.games
  }

  get raw(): GogStatusRaw | null {
    return this.status
  }

  summary(): GogSummary {
    return { fromCache: this.fromCache, error: this.lib.error || undefined, games: this.lib.games.length }
  }

  game(id: string): Game | undefined {
    return this.games.find((g) => g.id === id)
  }

  /** description / art list of a game from the server's catalog (or its offline copy) */
  info(id: string): GogInfoRaw | undefined {
    const pid = gogPid(id)
    return pid ? this.lib.games.find((g) => g.product_id === pid)?.info : undefined
  }

  private apply(): void {
    this.games = gogGames(this.lib, this.status)
    this.emit('library')
  }

  /** server = ask the server for its catalog (else only local installs are re-read) */
  async refresh(server = false): Promise<void> {
    if (this.engine.state !== 'ready') return
    if (server) this.lastCatalog = Date.now()
    try {
      const lib = await this.engine.call<GogLibraryRaw>('gog_library', [server], 60_000)
      // the engine keeps its own offline copy; without a server it answers from it
      this.lib = lib
      this.fromCache = !lib.fresh
      this.apply()
      await this.cache.save(lib)
    } catch (e) {
      log.warn('gog', `library: ${(e as Error).message}`)
    }
  }

  private startPolling(): void {
    this.stopPolling()
    const tick = async (): Promise<void> => {
      try {
        const st = await this.engine.call<GogStatusRaw>('gog_status', [], 10_000)
        const prev = this.status
        this.status = st
        const key = (s: GogStatusRaw | null): string => JSON.stringify([s?.jobs.map((j) => [j.product_id, j.phase]), s?.running])
        // a job finished or a game started/ended: read the local installs again (no server needed)
        let ended = (prev?.jobs ?? []).some((j) => !st.jobs.some((x) => x.product_id === j.product_id))
        // a job may start and finish between two ticks — its result message still says it ended
        const seen = this.lastMsgAt
        for (const [pid, m] of Object.entries(st.last)) {
          if (m.at > seen) {
            this.lastMsgAt = Math.max(this.lastMsgAt, m.at)
            if (prev) {
              ended = true
              this.emit('message', { gameId: gogId(pid), ...m })
            }
          }
        }
        if (Date.now() - this.lastCatalog > CATALOG_MS) void this.refresh(true)
        else if (ended) void this.refresh(false)
        if (key(prev) !== key(st) || JSON.stringify(prev?.jobs) !== JSON.stringify(st.jobs)) this.apply()
        this.emit('status', st)
      } catch (e) {
        log.warn('gog', `status: ${(e as Error).message}`)
      }
      if (this.engine.state === 'ready') this.timer = setTimeout(() => void tick(), POLL_MS)
    }
    void tick()
  }

  private stopPolling(): void {
    clearTimeout(this.timer)
    this.timer = undefined
  }

  stop(): void {
    this.stopPolling()
  }
}
