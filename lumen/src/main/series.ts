import { EventEmitter } from 'node:events'
import type { Game, IgdbSeries } from '@shared/types'
import { seriesLookupKey } from '@shared/series'
import type { EmustartEngine } from './emustart/engine'
import { JsonFile } from './store/jsonFile'
import { log } from './logger'

/**
 * Serie gier z IGDB z serwera EmuStart (decyzja 2026-11-16: zapytania robi serwer, emustart/igdbseries.py — jak
 * PyLinks Web). Gry serwera (emulatory, GOG) serwer sprawdza sam; Lumen dosyła tylko tytuły, których serwer nie
 * zna (gry Steam i skróty). Wynik w pliku (działa bez serwera), zmiana → „change”. Ręczne poprawki gracza
 * (prefs.series) mają pierwszeństwo — shared/series.ts.
 */
interface Stored {
  at: number
  series: Record<string, IgdbSeries>
}

interface Answer {
  ok: boolean
  reason?: string
  enabled?: boolean
  series?: Record<string, { name?: string; order_ts?: number; release_ts?: number }>
  /** sprawdzone w IGDB, bez serii — Lumen nie zgaduje ich serii z tytułu */
  standalone?: string[]
  pending?: number
  /** tytuły tego Lumena, które serwer jeszcze sprawdza */
  own_pending?: number
}

const EVERY = 6 * 3600_000
const WHILE_PENDING = 3 * 60_000

export class SeriesService extends EventEmitter {
  private file: JsonFile<Stored>
  private data: Stored = { at: 0, series: {} }
  private busy = false
  private timer: NodeJS.Timeout | undefined

  constructor(
    dataFile: string,
    private readonly engine: EmustartEngine,
    private readonly games: () => Game[]
  ) {
    super()
    this.file = new JsonFile<Stored>(dataFile, () => ({ at: 0, series: {} }), (raw) => clean(raw))
  }

  async load(): Promise<void> {
    this.data = await this.file.load()
    // okno, które zapytało przed wczytaniem pliku, dostaje całość jako zmianę
    if (Object.keys(this.data.series).length) this.emit('change', { ...this.data.series })
  }

  /** Wszystkie znane serie (okno pobiera raz, potem tylko zmiany: zdarzenie „change”). */
  all(): Record<string, IgdbSeries> {
    return this.data.series
  }

  /** Seria gry z IGDB albo nic (serwer jej nie zna albo gra nie jest w serii). */
  of(g: Game): IgdbSeries | undefined {
    return this.data.series[seriesLookupKey(g)]
  }

  /** Pytanie serwera teraz, potem co EVERY (co WHILE_PENDING, dopóki serwer sprawdza gry). */
  schedule(delay = 0): void {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.sync(), delay)
  }

  async sync(): Promise<void> {
    if (this.busy || this.engine.state !== 'ready') return this.schedule(EVERY)
    this.busy = true
    let next = EVERY
    try {
      const extra = steamTitles(this.games())
      const r = await this.engine.call<Answer>('series_sync', [extra], 120_000)
      if (!r.ok) {
        log.info('series', `serie z serwera: ${r.reason ?? 'brak'}`)
        return
      }
      const series: Record<string, IgdbSeries> = {}
      for (const [k, v] of Object.entries(r.series ?? {})) {
        if (v && typeof v.name === 'string' && v.name.trim()) series[k] = { name: v.name.trim(), order: Number(v.order_ts) || 0, release: Number(v.release_ts) || 0 }
      }
      for (const k of r.standalone ?? []) if (typeof k === 'string' && !series[k]) series[k] = { name: '', order: 0, release: 0 }
      if (r.own_pending) next = WHILE_PENDING          // szybciej tylko, gdy serwer sprawdza gry TEGO Lumena
      const changes: Record<string, IgdbSeries | null> = {}
      for (const [k, v] of Object.entries(series)) {
        const old = this.data.series[k]
        if (!old || old.name !== v.name || old.order !== v.order || old.release !== v.release) changes[k] = v
      }
      for (const k of Object.keys(this.data.series)) if (!(k in series)) changes[k] = null
      if (Object.keys(changes).length) {
        this.data = { at: Date.now(), series }
        await this.file.save(this.data)
        const inSeries = Object.values(series).filter((s) => s.name).length
        log.info('series', `serie z IGDB: ${inSeries} gier w seriach${r.pending ? `, serwer sprawdza jeszcze ${r.pending}` : ''}`)
        this.emit('change', changes)           // tylko zmiany — małe zdarzenie, bez migawki biblioteki
      }
    } catch (e) {
      log.warn('series', `serie z serwera: ${(e as Error).message}`)
    } finally {
      this.busy = false
      this.schedule(next)
    }
  }
}

/** Tytuły PC do dosłania (silnik wysyła tylko te, których serwer nie zna): Steam, skróty, GOG — tytuł zainstalowanej
 * gry bywa inny niż w katalogu archiwum serwera. Gry emulatorów serwer zna zawsze. */
export function steamTitles(games: Game[]): { title: string; platform: string }[] {
  const seen = new Set<string>()
  const out: { title: string; platform: string }[] = []
  for (const g of games) {
    if (g.source === 'emustart' || g.source === 'demo') continue
    const t = g.name.trim()
    if (!t || seen.has(t.toLowerCase())) continue
    seen.add(t.toLowerCase())
    out.push({ title: t, platform: 'pc' })
  }
  return out
}

function clean(raw: unknown): Stored {
  const r = raw as Partial<Stored> | null
  const series: Record<string, IgdbSeries> = {}
  for (const [k, v] of Object.entries((r && typeof r.series === 'object' && r.series) || {})) {
    const s = v as Partial<IgdbSeries>
    if (typeof s?.name === 'string') series[k] = { name: s.name, order: Number(s.order) || 0, release: Number(s.release) || 0 }
  }
  return { at: Number(r?.at) || 0, series }
}
