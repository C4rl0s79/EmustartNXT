import { EventEmitter } from 'node:events'
import type { Game, IgdbSeries } from '@shared/types'
import { seriesStoreKey } from '@shared/series'
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
  series?: Record<string, { name?: string; group?: string; order_ts?: number; release_ts?: number }>
  /** sprawdzone w IGDB, bez serii — Lumen nie zgaduje ich serii z tytułu */
  standalone?: string[]
  pending?: number
  /** tytuły tego Lumena, które serwer jeszcze sprawdza */
  own_pending?: number
  /** postęp sprawdzania na serwerze (serwer ≥ 0.66) */
  progress?: { running?: boolean } | null
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

  private loading: Promise<void> | null = null

  /** Plik z dysku — raz; all() i sync() czekają na niego (bez nadpisania nowszych danych starszymi). */
  load(): Promise<void> {
    if (!this.loading) {
      this.loading = this.file.load().then((d) => {
        this.data = d
      })
    }
    return this.loading
  }

  /** Wszystkie znane serie (okno pobiera raz, potem tylko zmiany: zdarzenie „change”). */
  async all(): Promise<Record<string, IgdbSeries>> {
    await this.load()
    return this.data.series
  }

  /** Pytanie serwera teraz, potem co EVERY (co WHILE_PENDING, dopóki serwer sprawdza gry). */
  schedule(delay = 0): void {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.sync(), delay)
  }

  async sync(): Promise<void> {
    if (this.busy || this.engine.state !== 'ready') return this.schedule(EVERY)
    this.busy = true
    await this.load()
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
        // seria (kolekcja) albo sama grupa (franczyza bez kolekcji: seria z tytułu, serwer ≥ 0.66)
        const name = typeof v?.name === 'string' ? v.name.trim() : ''
        const group = typeof v?.group === 'string' ? v.group.trim() : ''
        if (name || group) series[k] = { name, order: Number(v.order_ts) || 0, release: Number(v.release_ts) || 0, ...(group ? { group } : {}) }
      }
      for (const k of r.standalone ?? []) if (typeof k === 'string' && !series[k]) series[k] = { name: '', order: 0, release: 0 }
      if (r.own_pending) next = WHILE_PENDING          // szybciej tylko, gdy serwer sprawdza gry TEGO Lumena
      // przebieg serwera trwa — pasek „Serie z IGDB” od razu (main/serverActivity.ts), nie po kilku minutach
      if (r.progress?.running) this.emit('running')
      const changes: Record<string, IgdbSeries | null> = {}
      for (const [k, v] of Object.entries(series)) {
        const old = this.data.series[k]
        if (!old || old.name !== v.name || old.order !== v.order || old.release !== v.release || old.group !== v.group) changes[k] = v
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
export function steamTitles(games: Game[]): { title: string; platform: string; store?: string; id?: string }[] {
  const seen = new Set<string>()
  const out: { title: string; platform: string; store?: string; id?: string }[] = []
  for (const g of games) {
    if (g.source === 'emustart' || g.source === 'demo') continue
    const t = g.name.trim()
    // gra ze sklepu — z identyfikatorem (serwer dopasuje wydanie po nim, nie po tytule; zgłoszenie 2026-11-16)
    const sk = seriesStoreKey(g)
    const id = sk ? `${sk}` : `t:${t.toLowerCase()}`
    if (!t || seen.has(id)) continue
    seen.add(id)
    if (sk) {
      const [store, ext] = sk.split('|')
      out.push({ title: t, platform: 'pc', store, id: ext })
    } else out.push({ title: t, platform: 'pc' })
  }
  return out
}

function clean(raw: unknown): Stored {
  const r = raw as Partial<Stored> | null
  const series: Record<string, IgdbSeries> = {}
  for (const [k, v] of Object.entries((r && typeof r.series === 'object' && r.series) || {})) {
    const s = v as Partial<IgdbSeries>
    if (typeof s?.name === 'string')
      series[k] = { name: s.name, order: Number(s.order) || 0, release: Number(s.release) || 0, ...(typeof s.group === 'string' && s.group ? { group: s.group } : {}) }
  }
  return { at: Number(r?.at) || 0, series }
}
