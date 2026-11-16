import { EventEmitter } from 'node:events'
import type { SeriesStatus, ServerActivity } from '@shared/types'
import type { EmustartEngine } from './emustart/engine'
import { log } from './logger'

/**
 * Wymiana „systemowa” z serwerem EmuStart widoczna w oknie (prośba 2026-11-16: „skąd mam wiedzieć, że działa?”):
 * mały pasek z opisem pod „EmuStart” — serie z IGDB (postęp z serwera), zapisy (silnik: sync_progress), grafiki
 * gracza, motywy TV, lista gier z serwera (bez procentu: tylko „trwa”). Pobieranie gier — osobno (zadania, Job).
 * Tylko do głównego okna (Deck tego nie pokazuje).
 */

/** krótka wymiana nie miga paskiem: widoczna dopiero, gdy trwa dłużej */
export const SHOW_AFTER_MS = 700
const SAVES_IDLE_MS = 10_000
const SAVES_ACTIVE_MS = 1000
const SERIES_RUNNING_MS = 15_000
const SERIES_IDLE_MS = 5 * 60_000
const EMIT_MS = 200
const ENGINE_DOWN = 'Silnik EmuStart nie działa — stan serii nieznany.'

interface SavesProgress {
  active: boolean
  /** gotowy opis z silnika (syncclient.progress_text); starszy silnik — bez niego */
  text?: string
  op?: 'send' | 'get' | 'pack'
  done?: number
  total?: number
  eta?: number
}

interface SeriesAnswer {
  ok: boolean
  reason?: string
  enabled?: boolean
  progress?: { running?: boolean; done?: number; total?: number; checked?: number; in_series?: number; last_batch?: number; error?: string } | null
}

const num = (n: number): string => Math.round(n).toLocaleString('pl-PL')

/** „wysłano 120 / 262 MB · ok. 1 min” — tylko dla silnika bez gotowego tekstu (sync_progress.text) */
export function savesText(p: SavesProgress): string {
  const mb = (n: number): string => (n >= 10 * 1048576 ? (n / 1048576).toFixed(0) : (n / 1048576).toFixed(1))
  const verb = p.op === 'send' ? 'wysłano' : p.op === 'get' ? 'pobrano' : p.op === 'pack' ? 'spakowano' : ''
  const t = p.eta ?? -1
  const left = t < 0 ? '' : t < 60 ? ` · ok. ${t} s` : ` · ok. ${Math.round(t / 60)} min`
  return `${verb} ${mb(p.done ?? 0)} / ${mb(p.total ?? 0)} MB${left}`.trim()
}

/** odpowiedź silnika (series_progress) → stan do Ustawień */
export function seriesStatusOf(r: SeriesAnswer, now = Date.now()): SeriesStatus {
  if (!r.ok) return { state: 'error', reason: r.reason ?? 'Brak odpowiedzi serwera.', at: now }
  if (!r.enabled) {
    return { state: 'nokeys', reason: 'Serwer nie ma kluczy IGDB — serie tylko z tytułów (panel serwera → klucze źródeł grafik).', at: now }
  }
  const p = r.progress ?? {}
  return {
    state: 'ok',
    running: !!p.running,
    done: Number(p.done) || 0,
    total: Number(p.total) || 0,
    checked: Number(p.checked) || 0,
    inSeries: Number(p.in_series) || 0,
    lastBatch: Number(p.last_batch) ? Number(p.last_batch) * 1000 : undefined,
    error: p.error || undefined,
    at: now
  }
}

/** pasek „Serie z IGDB” z postępu, albo nic (sprawdzanie nie trwa) */
export function seriesActivity(s: SeriesStatus): ServerActivity | null {
  if (s.state !== 'ok' || !s.running) return null
  const total = Math.max(s.total ?? 0, s.done ?? 0)
  return {
    id: 'series',
    label: 'Serie z IGDB',
    detail: `sprawdzone ${num(s.done ?? 0)} z ${num(total)}${s.error ? ` · ${s.error}` : ''}`,
    done: s.done ?? 0,
    total
  }
}

export class ServerActivityBoard extends EventEmitter {
  private items = new Map<string, ServerActivity>()
  /** track(): ile trwa naraz i zegar pokazania (krótkie nie migają) */
  private running = new Map<string, { n: number; timer?: NodeJS.Timeout }>()
  private emitTimer: NodeJS.Timeout | undefined
  private seriesState: SeriesStatus = { state: 'unknown' }
  private savesTimer: NodeJS.Timeout | undefined
  private seriesTimer: NodeJS.Timeout | undefined
  private engine: EmustartEngine | null = null

  list(): ServerActivity[] {
    return [...this.items.values()]
  }

  series(): SeriesStatus {
    return this.seriesState
  }

  set(a: ServerActivity): void {
    const old = this.items.get(a.id)
    if (old && JSON.stringify(old) === JSON.stringify(a)) return
    this.items.set(a.id, a)
    this.changed()
  }

  end(id: string): void {
    if (this.items.delete(id)) this.changed()
  }

  /** Wymiana bez procentu: pasek „trwa” od SHOW_AFTER_MS do końca `fn` (kilka naraz o tym samym id — jeden pasek). */
  async track<T>(id: string, label: string, fn: () => Promise<T>): Promise<T> {
    const r = this.running.get(id) ?? { n: 0 }
    r.n++
    if (r.n === 1) r.timer = setTimeout(() => this.set({ id, label }), SHOW_AFTER_MS)
    this.running.set(id, r)
    try {
      return await fn()
    } finally {
      r.n--
      if (r.n <= 0) {
        clearTimeout(r.timer)
        this.running.delete(id)
        this.end(id)
      }
    }
  }

  private changed(): void {
    if (this.emitTimer) return
    this.emitTimer = setTimeout(() => {
      this.emitTimer = undefined
      this.emit('change', this.list())
    }, EMIT_MS)
  }

  /** Pytanie silnika o zapisy i serie — od teraz, dopóki działa Lumen. */
  start(engine: EmustartEngine): void {
    this.engine = engine
    this.pollSaves(0)
    this.pollSeries(5000)
  }

  /** postęp serii — za chwilę (np. po pytaniu o serie albo po połączeniu z serwerem) */
  pokeSeries(ms = 2000): void {
    this.pollSeries(ms)
  }

  private pollSaves(ms: number): void {
    clearTimeout(this.savesTimer)
    this.savesTimer = setTimeout(() => void this.saves(), ms)
  }

  private async saves(): Promise<void> {
    const e = this.engine
    let next = SAVES_IDLE_MS
    try {
      if (e?.state !== 'ready') {
        this.end('saves')
        return
      }
      const p = await e.call<SavesProgress>('sync_progress', [], 5_000)
      if (p?.active && p.total) {
        next = SAVES_ACTIVE_MS
        this.set({ id: 'saves', label: 'Zapisy', detail: p.text || savesText(p), done: p.done ?? 0, total: p.total })
      } else this.end('saves')
    } catch {
      this.end('saves')
    } finally {
      this.pollSaves(next)
    }
  }

  private pollSeries(ms: number): void {
    clearTimeout(this.seriesTimer)
    this.seriesTimer = setTimeout(() => void this.seriesPoll(), ms)
  }

  private async seriesPoll(): Promise<void> {
    const e = this.engine
    let next = SERIES_IDLE_MS
    try {
      if (e?.state !== 'ready') {
        // Ustawienia nie zostają na „Sprawdzam…” ani na starym postępie
        if (this.seriesState.state !== 'error' || this.seriesState.reason !== ENGINE_DOWN) {
          this.seriesState = { state: 'error', reason: ENGINE_DOWN, at: Date.now() }
          this.emit('series', this.seriesState)
        }
        this.end('series')
        next = 30_000
        return
      }
      const r = await e.call<SeriesAnswer>('series_progress', [], 30_000)
      const s = seriesStatusOf(r)
      if (s.state === 'error' && this.seriesState.reason !== s.reason) log.info('series', `postęp serii: ${s.reason}`)
      this.seriesState = s
      this.emit('series', s)
      const a = seriesActivity(s)
      if (a) {
        next = SERIES_RUNNING_MS
        this.set(a)
      } else this.end('series')
    } catch (err) {
      // silnik bez series_progress (starszy) albo przerwa — bez paska; stan w Ustawieniach mówi, co jest
      this.seriesState = { state: 'error', reason: `Postęp serii: ${(err as Error).message}`, at: Date.now() }
      this.emit('series', this.seriesState)
      this.end('series')
    } finally {
      this.pollSeries(next)
    }
  }
}

/**
 * W trakcie przebiegu serwera nowe serie spływają porcjami: pełna lista serii najwyżej co 15 min i tylko, gdy
 * przybyło sprawdzonych gier, i raz na koniec przebiegu (code review 2026-11-16: co 3 min przez godziny to znów
 * duże paczki do okien).
 */
export class SeriesPassWatch {
  private checked = -1
  private at = 0
  private running = false

  constructor(private readonly every = 15 * 60_000) {}

  /** nowy stan z serwera → czy pobrać pełną listę serii teraz */
  refetch(s: SeriesStatus, now = Date.now()): boolean {
    if (s.state !== 'ok') return false
    const ended = this.running && !s.running
    this.running = !!s.running
    const checked = s.checked ?? 0
    if (this.checked < 0) this.checked = checked
    if (!ended && !(s.running && checked !== this.checked && now - this.at >= this.every)) return false
    this.checked = checked
    this.at = now
    return true
  }
}

/** jedna tablica na proces główny — korzystają z niej usługi (motywy, grafiki, biblioteka z serwera) */
export const serverActivity = new ServerActivityBoard()
