import { JsonFile } from '../store/jsonFile'
import { fetchWithTimeout, HttpError, Limiter } from '../net'
import { log } from '../logger'
import { normTitle, numbersMatch, plainTitle, similarity } from '../launchbox/match'

/**
 * Opis gry z Wikipedii (etap 23b) — ostatnie źródło, gdy sklep, GOG, serwer EmuStart i LaunchBox nie mają opisu.
 * Ten sam sposób co serwer EmuStart (`metadata.from_wikipedia`): wyszukiwanie „<tytuł> gra” (pl), potem
 * „<tytuł> video game” (en), artykuł o tytule podobnym co najmniej w 75 % i z tymi samymi numerami części,
 * streszczenie (bez stron ujednoznaczniających).
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

/** hit — artykuł; miss — sprawdzone, nie ma; unknown — nie sprawdzone (brak sieci, przerwa, szukanie trwa) */
export type WikiAnswer = { state: 'hit'; hit: WikiSummary } | { state: 'miss' } | { state: 'unknown' }

interface Entry {
  at: number
  hit?: WikiSummary
}

interface SummaryJson {
  type?: string
  extract?: string
  content_urls?: { desktop?: { page?: string } }
}

const DAY = 24 * 3600_000
const MISS_TTL = 7 * DAY
const HIT_TTL = 90 * DAY
const PAUSE_MIN = 120_000
const PAUSE_MAX = 30 * 60_000
const HINT = { pl: 'gra', en: 'video game' } as const
const UA = { 'User-Agent': 'Lumen-game-launcher/1.0 (game descriptions)', Accept: 'application/json' }
const UNKNOWN: WikiAnswer = { state: 'unknown' }
const MISS: WikiAnswer = { state: 'miss' }

type Fetcher = typeof fetchWithTimeout

/**
 * z wyników wyszukiwania — artykuły, których tytuł (bez dopisku w nawiasie) jest podobny do szukanego i ma te same
 * numery części („Final Fantasy” to nie „Final Fantasy V”), najbardziej podobny pierwszy
 */
export function wikiCandidates(title: string, hits: { title?: string }[]): string[] {
  const want = normTitle(title)
  return hits
    .map((hit) => String(hit?.title ?? ''))
    .map((page) => ({ page, clean: page.replace(/\s*\(.*?\)\s*$/u, '') }))
    .filter(({ page, clean }) => page && numbersMatch(title, clean))
    .map((cand) => ({ ...cand, score: normTitle(cand.clean) === want ? 2 : similarity(title, cand.clean) }))
    .filter((cand) => cand.score >= 0.75)
    .sort((left, right) => right.score - left.score)
    .map((cand) => cand.page)
}

const answerOf = (hit: WikiSummary | null | undefined): WikiAnswer => (hit ? { state: 'hit', hit } : MISS)

/** przerwa po odmowie 429: Retry-After, ale co najmniej 2 min i najwyżej 30 min (nieczytelny nagłówek — 2 min) */
export function pauseAfter429(retryAfterMs: number | undefined): number {
  const asked = Number.isFinite(retryAfterMs) ? Number(retryAfterMs) : 0
  return Math.min(Math.max(asked, PAUSE_MIN), PAUSE_MAX)
}

export class WikipediaDescriptions {
  private cache: Record<string, Entry> | null = null
  private readonly file: JsonFile<Record<string, Entry>>
  private readonly pending = new Map<string, Promise<WikiAnswer>>()
  private readonly queue = new Limiter(1, 'wikipedia', true)
  private pausedUntil = 0

  constructor(
    file: string,
    private readonly fetcher: Fetcher = fetchWithTimeout
  ) {
    this.file = new JsonFile(file, () => ({}))
  }

  /** zapomina wszystko (Ustawienia → wyczyść pamięć podręczną: plik na dysku usuwa wywołujący) */
  clear(): void {
    this.cache = {}
  }

  /**
   * opis gry; `force` — bez zapisu z dysku; `waitMs` — najdłużej tyle czeka na sieć, potem `unknown`
   * (szukanie trwa dalej i zapisuje wynik — następne otwarcie gry go pokaże)
   */
  async summary(name: string, opts: { force?: boolean; waitMs?: number } = {}): Promise<WikiAnswer> {
    const title = plainTitle(name).replace(/[™®©]/gu, '').trim()
    const key = normTitle(title)
    if (key.length < 2) return MISS
    const cache = await this.loaded()
    const known = cache[key]
    if (!opts.force && known && Date.now() - known.at < (known.hit ? HIT_TTL : MISS_TTL)) return answerOf(known.hit)
    const job = this.pending.get(key) ?? this.start(key, title, known)
    if (!opts.waitMs) return job
    let timer: NodeJS.Timeout | undefined
    const late = new Promise<WikiAnswer>((resolve) => {
      timer = setTimeout(() => resolve(known?.hit ? answerOf(known.hit) : UNKNOWN), opts.waitMs)
    })
    return Promise.race([job, late]).finally(() => clearTimeout(timer))
  }

  private async loaded(): Promise<Record<string, Entry>> {
    this.cache ??= await this.file.load()
    return this.cache
  }

  private start(key: string, title: string, known: Entry | undefined): Promise<WikiAnswer> {
    const job = this.lookup(title)
      .then(async (hit) => {
        const cache = await this.loaded()
        cache[key] = { at: Date.now(), ...(hit ? { hit } : {}) }
        await this.file.save(cache).catch(() => undefined)
        return answerOf(hit)
      })
      // brak sieci i odmowa to nie „brak artykułu”: nic nie zapisujemy, zostaje poprzedni wynik
      .catch((err: Error) => {
        log.warn('wiki', `${title}: ${err.message}`)
        return known?.hit ? answerOf(known.hit) : UNKNOWN
      })
      .finally(() => this.pending.delete(key))
    this.pending.set(key, job)
    return job
  }

  /** jedno zapytanie (w kolejce); po odmowie 429 — przerwa */
  private get(url: string): Promise<Response> {
    return this.queue.run(async () => {
      if (Date.now() < this.pausedUntil) throw new Error('Wikipedia: przerwa po odmowie (za dużo zapytań)')
      try {
        return await this.fetcher(url, { headers: UA }, 12_000)
      } catch (err) {
        if (err instanceof HttpError && err.status === 429) this.pausedUntil = Date.now() + pauseAfter429(err.retryAfterMs)
        throw err
      }
    })
  }

  private async lookup(title: string): Promise<WikiSummary | null> {
    for (const lang of ['pl', 'en'] as const) {
      const hit = await this.lookupIn(lang, title)
      if (hit) return hit
    }
    return null
  }

  private async lookupIn(lang: 'pl' | 'en', title: string): Promise<WikiSummary | null> {
    const query = new URLSearchParams({ action: 'query', list: 'search', format: 'json', srlimit: '3', srsearch: `${title} ${HINT[lang]}` })
    const res = await this.get(`https://${lang}.wikipedia.org/w/api.php?${query}`)
    const hits = ((await res.json()) as { query?: { search?: { title?: string }[] } })?.query?.search ?? []
    for (const page of wikiCandidates(title, hits)) {
      const summary = await this.pageSummary(lang, page)
      const text = summary?.type === 'disambiguation' ? '' : (summary?.extract?.trim() ?? '')
      if (!text) continue
      const url = summary?.content_urls?.desktop?.page
      return { text, lang, title: page, ...(url ? { url } : {}) }
    }
    return null
  }

  /** brak strony (404) — null, następny kandydat; odmowa i brak sieci przerywają całe szukanie (bez zapisu) */
  private async pageSummary(lang: 'pl' | 'en', page: string): Promise<SummaryJson | null> {
    try {
      const res = await this.get(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(page.replace(/ /gu, '_'))}`)
      return (await res.json()) as SummaryJson
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) return null
      throw err
    }
  }
}
