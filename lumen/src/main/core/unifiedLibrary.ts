import { EventEmitter } from 'node:events'
import type { Game, JobsSnapshot, LibrarySnapshot, PlatformInfo } from '@shared/types'
import { classify, classifyContext } from '@shared/libraryNav'
import type { LibraryService } from '../library/service'
import type { EmustartProvider } from '../emustart/provider'
import type { GogProvider } from '../gog/provider'
import type { XboxProvider } from '../xbox/provider'
import { RateMeter, emuJobs, steamJobs } from './jobs'
import { timed } from '../perfTime'
import { gogJobs } from '../gog/provider'

export interface UnifiedOptions {
  /** prefs.platformOverrides — the player's platform for ambiguous Steam shortcuts */
  overrides: () => Record<string, string>
  /** EmuStart's system catalog (classification of shortcuts by their Steam tags) */
  platforms: () => PlatformInfo[]
}

/**
 * One library for both interfaces: Steam games (LibraryService), EmuStart games (EmustartProvider) and
 * GOG games from the EmuStart server (GogProvider) side by side. Games are never merged by title — the
 * Steam, GOG and emulated releases of one title are separate entries with their own ids and actions.
 * Every game gets its family and platform (Game.platform) for the library hierarchy.
 * Emits "snapshot" (LibrarySnapshot) and "jobs" (JobsSnapshot).
 */
export class UnifiedLibrary extends EventEmitter {
  private snap: LibrarySnapshot
  private jobsSnap: JobsSnapshot = { jobs: [], emu: null }
  /** prędkość i czas do końca pobierań Steam (Steam ich nie podaje — etap 7) */
  private steamRate = new RateMeter()
  /** co 10 s, gdy trwa pobieranie Steam: liczniki mogą stać (bez zapisu manifestu) — prędkość i czas wygasają */
  private steamTick: NodeJS.Timeout | undefined
  private byId = new Map<string, Game>()

  constructor(
    private readonly steam: LibraryService,
    private readonly emu: EmustartProvider,
    private readonly gog: GogProvider,
    private readonly opts: UnifiedOptions = { overrides: () => ({}), platforms: () => [] },
    private readonly xbox?: XboxProvider
  ) {
    super()
    this.snap = this.compose()
    steam.on('snapshot', () => this.update())
    emu.on('library', () => this.update())
    emu.on('status', () => this.updateJobs())
    gog.on('library', () => this.update())
    gog.on('status', () => this.updateJobs())
    xbox?.on('library', () => this.update())
  }

  private compose(): LibrarySnapshot {
    const s = this.steam.current
    const emustart = this.emu.summary()
    const platforms = this.opts.platforms()
    const ctx = classifyContext(emustart.systems, platforms, this.opts.overrides())
    const games = [...s.games, ...this.emu.currentGames, ...this.gog.currentGames, ...(this.xbox?.currentGames ?? [])].map((g) => ({
      ...g,
      platform: classify(g, ctx)
    }))
    return { ...s, games, emustart, gog: this.gog.summary(), platforms, ...(this.xbox ? { xbox: this.xbox.summary() } : {}) }
  }

  /** re-run after a classification input changed (a platform override, the platform catalog) */
  update(): void {
    this.snap = timed('budowa migawki biblioteki', () => this.compose())
    this.byId = new Map(this.snap.games.map((g) => [g.id, g]))
    this.emit('snapshot', this.snap)
    this.updateJobs()
  }

  private updateJobs(): void {
    const jobs = [...steamJobs(this.steam.current.games, this.steamRate), ...emuJobs(this.emu.raw, (n) => this.emu.lumenId(n)), ...gogJobs(this.gog.raw)]
    const steamLive = jobs.some((j) => j.kind === 'steamDownload' && j.state === 'active')
    if (steamLive && !this.steamTick) {
      this.steamTick = setInterval(() => this.updateJobs(), 10_000)
      this.steamTick.unref?.()
    } else if (!steamLive && this.steamTick) {
      clearInterval(this.steamTick)
      this.steamTick = undefined
    }
    const next: JobsSnapshot = { jobs, emu: this.emu.runtime() }
    if (JSON.stringify(next) === JSON.stringify(this.jobsSnap)) return
    this.jobsSnap = next
    this.emit('jobs', next)
  }

  get current(): LibrarySnapshot {
    return this.snap
  }

  get jobs(): JobsSnapshot {
    return this.jobsSnap
  }

  game(id: string): Game | undefined {
    return this.byId.get(id) ?? this.snap.games.find((g) => g.id === id)
  }
}
