import type { Game, Job } from '@shared/types'
import type { EmuStatusRaw } from '../emustart/provider'

// One task list for both interfaces. Every job is derived from the state reported by the
// integration that actually runs it — nothing is simulated:
//  - Steam downloads: install state and byte counters from Steam's appmanifest files (Steam
//    manages the download; Lumen can only show it and open Steam's download window),
//  - EmuStart: launch session, cache copies, emulator installs and save uploads from the engine.

export const LAUNCH_PHASE: Record<string, string> = {
  preparing: 'Przygotowanie',
  downloading: 'Pobieranie z serwera',
  extracting: 'Rozpakowywanie',
  running: 'Gra uruchomiona',
  finished: 'Koniec gry',
  error: 'Błąd uruchamiania',
  conflict: 'Konflikt zapisów — wybierz wersję',
  cancelled: 'Pobieranie przerwane'
}

const STEAM_PHASE: Partial<Record<Game['installState'], string>> = {
  installing: 'Instalacja w Steam',
  updating: 'Aktualizacja w Steam',
  updatePaused: 'Wstrzymane w Steam'
}

/**
 * Prędkość i czas do końca pobierania z kolejnych odczytów licznika bajtów (etap 7): Steam zapisuje liczniki
 * w manifeście co kilka sekund i nie podaje prędkości. Okno ostatnich `windowMs`; mniejszy licznik albo inna
 * wielkość pobierania (nowa aktualizacja) — liczenie od nowa.
 */
export class RateMeter {
  private samples = new Map<string, { t: number; done: number; total: number }[]>()
  /** kiedy licznik ostatnio się zmienił — pobieranie, które stoi dłużej niż okno, nie ma prędkości */
  private changed = new Map<string, number>()

  constructor(
    private windowMs = 30_000,
    // zegar monotoniczny: zegar systemowy może się cofnąć
    private now: () => number = () => performance.now()
  ) {}

  sample(key: string, done: number, total: number): { speed?: number; eta?: number } {
    const nowMs = this.now()
    let arr = this.samples.get(key) ?? []
    let last: { t: number; done: number; total: number } | undefined = arr[arr.length - 1]
    if (last && (done < last.done || total !== last.total)) {
      arr = [] // nowe pobieranie / inna aktualizacja — od nowa
      last = undefined
    }
    if (!last || done !== last.done) this.changed.set(key, nowMs)
    if (!last || nowMs > last.t) arr.push({ t: nowMs, done, total })
    arr = arr.filter((s, i) => i === arr.length - 1 || nowMs - s.t <= this.windowMs)
    this.samples.set(key, arr)
    const first = arr[0]
    if (!first) return {}
    const secs = (nowMs - first.t) / 1000
    if (secs < 2 || done <= first.done || nowMs - (this.changed.get(key) ?? nowMs) > this.windowMs) return {}
    const speed = (done - first.done) / secs
    return { speed: Math.round(speed), eta: Math.round(Math.max(0, total - done) / speed) }
  }

  /** zapomina klucze spoza `keys` (pobieranie skończone) */
  retain(keys: Set<string>): void {
    for (const k of this.samples.keys()) if (!keys.has(k)) this.samples.delete(k)
    for (const k of this.changed.keys()) if (!keys.has(k)) this.changed.delete(k)
  }
}

export function steamJobs(games: Game[], meter?: RateMeter): Job[] {
  const out: Job[] = []
  const live = new Set<string>()
  for (const g of games) {
    if (g.source !== 'steam') continue
    const phase = STEAM_PHASE[g.installState]
    if (!phase) continue
    const p = g.progress
    const total = p ? p.bytesToDownload || p.bytesToStage : 0
    const done = p ? (p.bytesToDownload ? p.bytesDownloaded : p.bytesStaged) : 0
    const key = `steam:${g.appId}`
    live.add(key)
    // wstrzymane w Steam: bez prędkości (liczniki stoją)
    const rate = meter && total > 0 && g.installState !== 'updatePaused' ? meter.sample(key, done, total) : {}
    out.push({
      id: `steam:${g.appId}`,
      kind: 'steamDownload',
      source: 'steam',
      gameId: g.id,
      title: g.name,
      phase,
      state: g.installState === 'updatePaused' ? 'queued' : 'active',
      progress: total > 0 ? { done, total, ...rate } : undefined,
      message: total > 0 ? undefined : 'Steam nie podaje jeszcze postępu (kolejka pobierania Steam).',
      cancellable: false,
      managedBySteam: true
    })
  }
  meter?.retain(live)
  return out
}

export function emuJobs(st: EmuStatusRaw | null, lumenIdOf: (engineId: number) => string | undefined): Job[] {
  if (!st) return []
  const out: Job[] = []
  const l = st.launch
  if (l && l.phase && l.phase !== 'idle') {
    const p = l.progress
    const showProgress = p && (l.phase === 'downloading' || l.phase === 'extracting' || (l.phase === 'running' && l.copying))
    out.push({
      id: 'emu:launch',
      kind: 'emuLaunch',
      source: 'emustart',
      gameId: l.game_id !== undefined ? lumenIdOf(l.game_id) : undefined,
      title: l.title ?? '',
      phase: l.mode === 'config' && l.phase === 'running' ? 'Ustawienia emulatora' : (LAUNCH_PHASE[l.phase] ?? l.phase),
      state:
        l.phase === 'error'
          ? 'error'
          : l.phase === 'cancelled'
            ? 'cancelled'
            : l.phase === 'finished'
              ? 'done'
              : l.phase === 'running'
                ? 'running'
                : l.phase === 'conflict'
                  ? 'waiting'
                  : 'active',
      progress: showProgress && p ? { done: p.done, total: p.total, speed: p.speed, eta: p.eta } : undefined,
      message: l.message || undefined,
      cancellable: l.phase === 'downloading'
    })
  }
  for (const c of st.copies) {
    out.push({
      id: `emu:copy:${c.game_id}`,
      kind: 'emuDownload',
      source: 'emustart',
      gameId: lumenIdOf(c.game_id),
      title: c.title,
      phase: 'Pobieranie do pamięci podręcznej',
      state: 'active',
      progress: { done: c.done, total: c.total, speed: c.speed, eta: c.eta },
      cancellable: true
    })
  }
  // emulator downloads from the server (installer.Job.status); finished ones drop off the list —
  // the game's readiness check shows what is still missing
  for (const [key, j, label, cancellable] of [
    ['install', st.install, 'Instalacja emulatorów z serwera', true],
    ['emusync', st.emu_sync, 'Aktualizacja emulatorów z serwera', false]
  ] as const) {
    if (!j?.running) continue
    out.push({
      id: `emu:${key}`,
      kind: 'emuInstall',
      source: 'emustart',
      title: j.current || label,
      phase: j.steps && j.steps > 1 ? `${label} (${j.step}/${j.steps})` : label,
      state: 'active',
      progress: j.total ? { done: j.done ?? 0, total: j.total } : undefined,
      cancellable
    })
  }
  if (st.post) {
    out.push({
      id: 'emu:saves',
      kind: 'saveUpload',
      source: 'emustart',
      title: st.post,
      phase: 'Wysyłanie zapisów na serwer',
      state: 'active',
      cancellable: false
    })
  }
  if (st.scan?.running) {
    out.push({
      id: 'emu:scan',
      kind: 'libraryRefresh',
      source: 'emustart',
      title: st.scan.text || 'Biblioteka z serwera',
      phase: 'Odświeżanie biblioteki',
      state: 'active',
      progress: st.scan.total ? { done: st.scan.done, total: st.scan.total } : undefined,
      cancellable: false
    })
  }
  return out
}
