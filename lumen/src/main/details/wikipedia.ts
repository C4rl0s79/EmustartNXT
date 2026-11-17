import { JsonFile } from '../store/jsonFile'
import { fetchWithTimeout, HttpError, Limiter } from '../net'
import { log } from '../logger'
import { normTitle, numbersMatch, plainTitle, similarity } from '../launchbox/match'

/**
 * Opis gry z Wikipedii (etap 23b) — ostatnie źródło, gdy sklep, GOG, serwer EmuStart i LaunchBox nie mają opisu.
 * Ten sam sposób co serwer EmuStart (`metadata.from_wikipedia`): wyszukiwanie „<tytuł> gra” (pl), potem
 * „<tytuł> video game” (en), artykuł o tytule podobnym co najmniej w 75 %, streszczenie (bez stron ujednoznaczniających).
 * Wynik i brak wyniku są zapisywane na dysku; brak — ponowna próba po 7 dniach, wynik — odświeżany po 90 dniach.
 * Wikimedia szybko odmawia (HTTP 429) programom, które pytają często: jedno zapytanie naraz (najnowsza gra pierwsza),
 * a po odmowie przerwa — w tym czasie bez pytań i bez zapisu „brak artykułu”.
 */
export interface WikiSummary {
  text: string
  lang: 'pl' | 'en'
  url?: string
  /** tytuł artykułu */
  title: string
}

interface Entry {
  at: number
  hit?: WikiSummary
}

const DAY = 24 * 3600_000
const MISS_TTL = 7 * DAY
const HIT_TTL = 90 * DAY
const HINT = { pl: 'gra', en: 'video game' } as const
const UA = { 'User-Agent': 'Lumen-game-launcher/1.0 (game descriptions)', Accept: 'application/json' }

type Fetcher = typeof fetchWithTimeout

/**
 * z wyników wyszukiwania — artykuły, których tytuł (bez dopisku w nawiasie) jest podobny do szukanego i ma te same
 * numery części („Final Fantasy” to nie „Final Fantasy V”), najbardziej podobny pierwszy
 */
export function wikiCandidates(title: string, hits: { title?: string }[]): string[] {
  return hits
    .map((h) => String(h?.title ?? ''))
    .map((page) => ({ page, clean: page.replace(/\s*\(.*?\)\s*$/, '') }))
    .filter(({ page, clean }) => page && numbersMatch(title, clean))
    .map((x) => ({ ...x, score: normTitle(x.clean) === normTitle(title) ? 2 : similarity(title, x.clean) }))
    .filter((x) => x.score >= 0.75)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.page)
}

export class WikipediaDescriptions {
  private cache: Record<string, Entry> | null = null
  private readonly file: JsonFile<Record<string, Entry>>
  private readonly pending = new Map<string, Promise<WikiSummary | null>>()
  private readonly queue = new Limiter(1, 'wikipedia', true)
  private pausedUntil = 0

  constructor(
    file: string,
    private readonly fetcher: Fetcher = fetchWithTimeout
  ) {
    this.file = new JsonFile(file, () => ({}))
  }

  /** streszczenie artykułu o grze; null — brak artykułu (albo brak sieci i brak zapisu) */
  async summary(name: string): Promise<WikiSummary | null> {
    const title = plainTitle(name).replace(/[™®©]/g, '').trim()
    const key = normTitle(title)
    if (key.length < 2) return null
    this.cache ??= await this.file.load()
    const known = this.cache[key]
    if (known && Date.now() - known.at < (known.hit ? HIT_TTL : MISS_TTL)) return known.hit ?? null
    const running = this.pending.get(key)
    if (running) return running
    const job = this.lookup(title)
      .then(async (hit) => {
        this.cache![key] = { at: Date.now(), ...(hit ? { hit } : {}) }
        await this.file.save(this.cache!).catch(() => undefined)
        return hit
      })
      // brak sieci to nie „brak artykułu”: nic nie zapisujemy, zostaje poprzedni wynik
      .catch((e: Error) => {
        log.warn('wiki', `${title}: ${e.message}`)
        return known?.hit ?? null
      })
      .finally(() => this.pending.delete(key))
    this.pending.set(key, job)
    return job
  }

  /** jedno zapytanie (w kolejce); po odmowie 429 — przerwa (domyślnie 2 min) */
  private get(url: string): Promise<Response> {
    return this.queue.run(async () => {
      if (Date.now() < this.pausedUntil) throw new Error('Wikipedia: przerwa po odmowie (za dużo zapytań)')
      try {
        return await this.fetcher(url, { headers: UA }, 12_000)
      } catch (e) {
        if (e instanceof HttpError && e.status === 429) this.pausedUntil = Date.now() + Math.min(Math.max(e.retryAfterMs ?? 0, 120_000), 30 * 60_000)
        throw e
      }
    })
  }

  private async lookup(title: string): Promise<WikiSummary | null> {
    for (const lang of ['pl', 'en'] as const) {
      const q = new URLSearchParams({ action: 'query', list: 'search', format: 'json', srlimit: '3', srsearch: `${title} ${HINT[lang]}` })
      const r = await this.get(`https://${lang}.wikipedia.org/w/api.php?${q}`)
      const hits = ((await r.json()) as { query?: { search?: { title?: string }[] } })?.query?.search ?? []
      for (const page of wikiCandidates(title, hits)) {
        // brak strony (404) — następny kandydat; odmowa i brak sieci przerywają całe szukanie (bez zapisu)
        const s = await this.get(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(page.replace(/ /g, '_'))}`)
          .then((x) => x.json() as Promise<{ type?: string; extract?: string; content_urls?: { desktop?: { page?: string } } }>)
          .catch((e: unknown) => {
            if (e instanceof HttpError && e.status === 404) return null
            throw e
          })
        if (!s || s.type === 'disambiguation' || !s.extract?.trim()) continue
        return { text: s.extract.trim(), lang, title: page, ...(s.content_urls?.desktop?.page ? { url: s.content_urls.desktop.page } : {}) }
      }
    }
    return null
  }
}
