import { EventEmitter } from 'node:events'
import type { Game, XboxSummary } from '@shared/types'
import { JsonFile } from '../store/jsonFile'
import { log } from '../logger'
import { sortKey } from '../library/merge'
import { gamePassIds, isStoreId, products, type XboxProduct } from './catalog'
import { scanInstalled, type XboxInstalled } from './installed'

/**
 * Gry Xbox / Microsoft Store w bibliotece (etap 19): zainstalowane na tym komputerze (19a), katalog PC Game Pass
 * (19b) i gry z konta Xbox (19c — `setOwned`). Nie łączy ich z grami Steam / GOG o tym samym tytule (osobne wydania).
 * Katalog (nazwy, grafiki) — z zapisem na dysku, odświeżany raz na dobę; działa bez sieci z ostatniej kopii.
 */
interface Cache {
  at: number
  gamePass: string[]
  products: Record<string, XboxProduct>
}

const DAY = 24 * 3600_000
const EMPTY: Cache = { at: 0, gamePass: [], products: {} }

/** Gry z danych: zainstalowane, z konta i z Game Pass — jedna pozycja na StoreId. */
export function xboxGames(installed: XboxInstalled[], cache: Cache, owned: ReadonlySet<string>, showGamePass = true): Game[] {
  const byPfn = new Map<string, XboxProduct>()
  for (const p of Object.values(cache.products)) if (p.pfn) byPfn.set(p.pfn.toLowerCase(), p)
  const gp = new Set(cache.gamePass)
  const out = new Map<string, Game>()
  const make = (storeId: string, p: XboxProduct | undefined, inst: XboxInstalled | undefined): Game => {
    const name = p?.title || inst?.name || storeId
    return {
      id: `xbox:${storeId}`,
      source: 'xbox',
      appId: 0,
      name,
      sortName: sortKey(name),
      provenance: [...(inst ? (['xboxLocal'] as const) : []), ...(owned.has(storeId) ? (['xboxAccount'] as const) : []), ...(gp.has(storeId) ? (['xboxGamePass'] as const) : [])],
      installState: inst ? 'installed' : 'notInstalled',
      installed: !!inst,
      ...(inst?.location ? { installDir: inst.location } : {}),
      xbox: {
        storeId,
        ...(inst?.pfn || p?.pfn ? { pfn: inst?.pfn || p?.pfn } : {}),
        ...(inst ? { aumid: inst.aumid } : {}),
        ...(inst?.titleId || p?.titleId ? { titleId: inst?.titleId || p?.titleId } : {}),
        gamePass: gp.has(storeId),
        owned: owned.has(storeId),
        ...(p?.year ? { year: p.year } : {})
      },
      ...(p?.year ? { facts: { year: String(p.year) } } : {})
    } as Game
  }
  for (const inst of installed) {
    const p = (inst.storeId && cache.products[inst.storeId]) || byPfn.get(inst.pfn.toLowerCase())
    const storeId = p?.storeId || inst.storeId || `PFN-${inst.pfn}`
    out.set(storeId, make(storeId, p, inst))
  }
  for (const id of owned) if (!out.has(id)) out.set(id, make(id, cache.products[id], undefined))
  if (showGamePass) for (const id of cache.gamePass) if (!out.has(id) && cache.products[id]) out.set(id, make(id, cache.products[id], undefined))
  return [...out.values()]
}

export class XboxProvider extends EventEmitter {
  private cache: Cache = EMPTY
  private installed: XboxInstalled[] = []
  private owned = new Set<string>()
  private games: Game[] = []
  private file: JsonFile<Cache>
  private error = ''
  private busy: Promise<void> | null = null
  private account: { gamertag: string } | null = null
  private accountError = ''

  constructor(
    cacheFile: string,
    private readonly showGamePass: () => boolean = () => true
  ) {
    super()
    this.file = new JsonFile<Cache>(cacheFile, () => EMPTY, (raw) => clean(raw))
  }

  get currentGames(): Game[] {
    return this.games
  }

  summary(): XboxSummary {
    return {
      installed: this.installed.length,
      gamePass: this.cache.gamePass.length,
      owned: this.owned.size,
      catalogAt: this.cache.at,
      ...(this.error || this.accountError ? { error: [this.error, this.accountError].filter(Boolean).join(' · ') } : {}),
      account: this.account
    }
  }

  /** dane do pobrania grafik gry (adres w katalogu Microsoft) */
  product(storeId: string): XboxProduct | undefined {
    return this.cache.products[storeId]
  }

  /** gry z konta Xbox (etap 19c); `error` — synchronizacja nieudana (zostaje poprzednia lista) */
  setOwned(ids: string[] | null, account: { gamertag: string } | null, error = ''): void {
    if (ids) this.owned = new Set(ids.map((x) => x.toUpperCase()))
    this.account = account
    this.accountError = error ? `Konto Xbox: ${error}` : ''
    void this.ensureProducts([...this.owned]).finally(() => {
      this.apply()
      this.emit('library')                          // stan konta w migawce (Ustawienia), także bez zmiany gier
    })
  }

  /** StoreId produktu z katalogu po rodzinie pakietu (gra z konta bez StoreId w historii) */
  storeIdByPfn(pfn: string): string | undefined {
    const k = pfn.toLowerCase()
    return Object.values(this.cache.products).find((p) => p.pfn?.toLowerCase() === k)?.storeId ?? this.installed.find((i) => i.pfn.toLowerCase() === k)?.storeId
  }

  /** ponownie po zmianie ustawień (pokazywanie katalogu Game Pass) */
  reapply(): void {
    this.apply()
  }

  /** Zainstalowane teraz, katalog — gdy starszy niż doba (albo `force`). */
  refresh(force = false): Promise<void> {
    if (this.busy) return this.busy
    this.busy = (async () => {
      try {
        if (!this.cache.at) this.cache = await this.file.load()
        // nieudany odczyt (PowerShell, limit czasu) — zostaje poprzednia lista, gry nie znikają (przegląd kodu)
        const now = await scanInstalled()
        if (now) this.installed = now
        this.apply()
        if (force || Date.now() - this.cache.at > DAY) {
          const ids = await gamePassIds()
          const known = this.cache.products
          const missing = [...ids, ...this.installed.map((i) => i.storeId).filter(Boolean)].filter((id) => !known[id])
          const fresh = force ? await products([...ids, ...this.installed.map((i) => i.storeId).filter(Boolean)]) : await products(missing)
          // opisy dodane w międzyczasie (gry z konta: ensureProducts) zostają — scalanie z aktualnym stanem
          this.cache = { at: Date.now(), gamePass: ids, products: { ...this.cache.products, ...fresh } }
          await this.file.save(this.cache)
          log.info('xbox', `katalog: Game Pass ${ids.length} gier, zainstalowane ${this.installed.length}`)
        } else await this.ensureProducts(this.installed.map((i) => i.storeId).filter(Boolean))
        this.error = ''
      } catch (e) {
        this.error = `Katalog Microsoft: ${(e as Error).message}`
        log.warn('xbox', this.error)
      } finally {
        this.apply()
        this.busy = null
      }
    })()
    return this.busy
  }

  /** opisy brakujących produktów (gra zainstalowana później niż pobrano katalog, gra z konta) */
  private async ensureProducts(ids: string[]): Promise<void> {
    const missing = ids.filter((id) => id && !this.cache.products[id] && isStoreId(id))
    if (!missing.length) return
    try {
      const fresh = await products(missing)
      this.cache = { ...this.cache, products: { ...this.cache.products, ...fresh } }
      await this.file.save(this.cache)
    } catch (e) {
      log.warn('xbox', `opisy gier: ${(e as Error).message}`)
    }
  }

  private apply(): void {
    const next = xboxGames(this.installed, this.cache, this.owned, this.showGamePass())
    if (JSON.stringify(next) === JSON.stringify(this.games)) return
    this.games = next
    this.emit('library')
  }
}

function clean(raw: unknown): Cache {
  const r = (raw ?? {}) as Partial<Cache>
  const products: Record<string, XboxProduct> = {}
  for (const [k, v] of Object.entries(r.products && typeof r.products === 'object' ? r.products : {})) {
    if (v && typeof v === 'object' && typeof (v as XboxProduct).title === 'string') products[k] = v as XboxProduct
  }
  return { at: Number(r.at) || 0, gamePass: Array.isArray(r.gamePass) ? r.gamePass.filter((x) => typeof x === 'string') : [], products }
}
