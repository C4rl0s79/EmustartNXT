import type { Game, IgdbSeries } from './types'

// Serie gier: na listach po tytule gry jednej serii stoją razem — pod nazwą serii, w kolejności wydania
// (wybór gracza 2026-11-13: „obok siebie w sortowaniu”; 2026-11-16: „każda seria osobno”, pod własną nazwą).
// Seria z IGDB przez serwer EmuStart (Game.igdbSeries — kolekcja; franczyza to grupa, nie seria — zgłoszenie
// 2026-11-16: „Dungeons & Dragons” łączyło Baldur's Gate, Pool of Radiance i Eye of the Beholder), bez niej — z tytułu.
// Seria nie miesza platform (decyzja 2026-11-16: Steam tylko ze Steam, GOG z GOG, PS2 z PS2 — mieszanie to ręczne
// grupy). Gracz może ją poprawić (Opcje gry → Seria), a jego wybór zostaje w preferencjach (prefs.series) i wygrywa.
// Czyste funkcje — tests/series.test.ts.

/** Wybór gracza dla jednej gry: inna nazwa serii, „nie należy do serii”, miejsce w serii, grupa. */
export interface SeriesPref {
  /** nazwa serii nadana przez gracza (gra dołącza do każdej gry tej platformy z tą samą nazwą) */
  name?: string
  /** gra nie należy do żadnej serii */
  none?: boolean
  /** miejsce w serii ustawione przez gracza (mniejsze — wcześniej) */
  order?: number
  /** grupa nad serią nadana przez gracza (np. „Dungeons & Dragons”) — tylko opis w oknie „Seria” */
  group?: string
}

export type SeriesPrefs = Record<string, SeriesPref>

const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12, xiii: 13 }
const MARKS = /[™®©]/g
/** dopiski wydania na końcu tytułu — nie są częścią nazwy serii („Ultima VIII Gold Edition” → Ultima, 8) */
const EDITION =
  /\s+(?:(?:gold|platinum|deluxe|special|enhanced|definitive|complete|ultimate|anniversary|game of the year|goty|collector'?s)(?:\s+edition)?|(?:digital|legacy|premium|royal|steam|gog)\s+edition|edition|remastered|remaster|remake|classic|hd|redux|reloaded|director'?s cut|final cut)$/i
/** przedrostki marki — w kluczu serii pomijane („Sid Meier's Pirates!” i „Pirates! Gold” to ta sama seria) */
const BRAND = /^(?:sid meier s|tom clancy s|clive barker s|american mcgee s|disney s|disney pixar|marvel s|james cameron s|peter jackson s|frank herbert s|robert ludlum s|lord british s)\s+/

// Seria z IGDB dla gry: okno (renderer) ustawia źródło — mapę z serwera pobraną raz i łataną samymi zmianami
// (library.series / onSeries). Migawka biblioteki jej nie niesie (40 tys. gier przy każdej zmianie, także do Decka).
// domyślnie pole gry (testy); okno ustawia mapę z serwera (store.ts) — migawka tego pola nie wypełnia
let igdbOf: (g: Game) => IgdbSeries | undefined = (g) => g.igdbSeries
export function setIgdbResolver(fn: (g: Game) => IgdbSeries | undefined): void {
  igdbOf = fn
}

// wyniki po tytule — listy budowane są często (40 tys. gier: bez pamięci +110 ms na każde zbudowanie nawigacji)
const parsedCache = new Map<string, { base: string; num?: number }>()
const keyCache = new Map<string, string>()
const CACHE_MAX = 200_000

/** Tytuł → nazwa serii i numer części: „Wing Commander III: Heart of the Tiger” → Wing Commander, 3. */
export function parseSeries(title: string): { base: string; num?: number } {
  let hit = parsedCache.get(title)
  if (!hit) {
    if (parsedCache.size > CACHE_MAX) parsedCache.clear()
    parsedCache.set(title, (hit = parseTitle(title)))
  }
  return hit
}

const partNum = (s: string): number | undefined => (/^\d+$/.test(s) ? Number(s) : ROMAN[s.toLowerCase()])

function parseTitle(title: string): { base: string; num?: number } {
  const t = title.replace(MARKS, '').replace(/\s*[([][^)\]]*[)\]]\s*$/, '').trim()
  // część przed podtytułem: „Seria: podtytuł”, „Seria - podtytuł”
  let head = t.split(/\s*:\s+|\s+[-–—]\s+/)[0].trim()
  const bare = head
  for (let i = 0; i < 3 && EDITION.test(head); i++) head = head.replace(EDITION, '').trim()
  // numer części, także zakres („Tomb Raider I-III Remastered” → 1)
  const m = /^(.*?\S)\s+(?:(?:part|episode|chapter|vol\.?|volume)\s+)?(\d{1,4}|[ivx]{1,4})(?:\s*[-–]\s*(?:\d{1,4}|[ivx]{1,4}))?$/i.exec(head)
  if (m) {
    const n = partNum(m[2])
    if (n !== undefined) return { base: m[1].replace(/[\s:,-]+$/, ''), num: n }
  }
  return bare === t && head === bare ? { base: head, num: 1 } : { base: head }
}

/** Klucz nazwy serii: bez wielkości liter, „The”, ™®, przedrostka marki; „&” = „and”. */
export function seriesKey(name: string): string {
  let hit = keyCache.get(name)
  if (hit === undefined) {
    if (keyCache.size > CACHE_MAX) keyCache.clear()
    keyCache.set(name, (hit = keyOf(name)))
  }
  return hit
}

function keyOf(name: string): string {
  return name
    .toLowerCase()
    .replace(MARKS, '')
    .replace(/&/g, ' and ')
    .replace(/^the\s+/, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(BRAND, '')
}

/** Platforma gry dla serii: Steam, GOG, skróty, każdy system emulatora osobno. */
export function seriesScope(g: Game): string {
  return g.source === 'emustart' ? `es:${(g.emu?.es ?? '').toLowerCase()}` : g.source
}

/** Seria gry: klucz (z platformą), nazwa do pokazania, numer części, grupa — albo nic. */
export type Found = { key: string; name: string; num?: number; group?: string } | undefined
/** seria rozpoznana bez wyboru gracza, przy obiekcie gry — ważna, dopóki tytuł i wynik IGDB te same */
const autoCache = new WeakMap<Game, { title: string; igdb: IgdbSeries | undefined; found: Found }>()

export function seriesOf(g: Game, prefs: SeriesPrefs | undefined): Found {
  const p = prefs?.[g.id]
  if (!p) {
    const hit = autoCache.get(g)
    const igdb = igdbOf(g)
    if (hit && hit.title === g.name && hit.igdb === igdb) return hit.found
    const found = findSeries(g, undefined)
    autoCache.set(g, { title: g.name, igdb, found })
    return found
  }
  return findSeries(g, p)
}

/** Klucz wyniku serii z serwera: „snes|super metroid”, „pc|cyberpunk 2077” (emustart/igdbseries.key_of). */
export function seriesLookupKey(g: Game): string {
  const src = g.source === 'emustart' && g.emu?.es ? g.emu.es.toLowerCase() : 'pc'
  return `${src}|${g.name.toLowerCase().split(/\s+/).filter(Boolean).join(' ')}`
}

/** Klucz gry ze sklepu po identyfikatorze: „steam|203160”, „gog|1207658930” (emustart/igdbseries.store_key) —
 * serwer dopasowuje ją wtedy po identyfikatorze, nie po tytule; okno szuka najpierw po nim, potem po tytule. */
export function seriesStoreKey(g: Game): string | undefined {
  if (g.source === 'steam' && g.appId > 0) return `steam|${g.appId}`
  if (g.source === 'gog' && g.gog?.productId) return `gog|${g.gog.productId}`
  return undefined
}

function findSeries(g: Game, p: SeriesPref | undefined): Found {
  if (p?.none) return undefined
  const ig = igdbOf(g)
  const group = p?.group?.trim() || ig?.group?.trim() || undefined
  // IGDB zna grę, ale bez serii i bez grupy: nie zgadujemy z tytułu (błędna seria gorsza niż jej brak). Z samą
  // grupą (franczyza bez kolekcji) — seria z tytułu: remaster dołącza do serii oryginału, gra bez pary zostaje sama.
  if (!p?.name && ig && !ig.name.trim() && !group) return undefined
  const parsed = parseSeries(g.name)
  const name = p?.name?.trim() || properName(ig?.name?.trim() ?? '', parsed.base) || parsed.base
  const nameKey = seriesKey(name)
  // jedna litera albo samo „The” to nie seria; własna nazwa gracza i seria z IGDB — zawsze
  if (!p?.name && !ig?.name?.trim() && nameKey.replace(/\s/g, '').length < 3) return undefined
  return {
    key: `${seriesScope(g)}|${nameKey}`,
    name,
    ...(parsed.num !== undefined ? { num: parsed.num } : {}),
    ...(group ? { group } : {})
  }
}

/** nazwa z IGDB z samych małych liter (część kolekcji: „deus ex”) — zapisana jak w tytule gry, gdy to ta sama seria */
function properName(ig: string, base: string): string {
  if (!ig || ig !== ig.toLowerCase()) return ig
  if (seriesKey(base) === seriesKey(ig) && base !== base.toLowerCase()) return base
  return ig.replace(/(^|\s)\p{Ll}/gu, (c) => c.toUpperCase())
}

export const yearOf = (g: Game): number | undefined => {
  const y = parseInt(g.emu?.year || g.facts?.year || '', 10)
  return y > 1900 && y < 3000 ? y : undefined
}

const UNKNOWN = Number.MAX_SAFE_INTEGER
/** rok z daty IGDB (s) — w obrębie roku kolejność ustala numer części (pełne daty w IGDB bywają błędne) */
const yearOfTs = (t: number): number => new Date(t * 1000).getUTCFullYear()

/**
 * Kolejność w serii: miejsce ustawione przez gracza, potem data oryginału z IGDB (remake / remaster przy oryginale)
 * dla każdej gry, która ją ma — gry bez niej wchodzą między znane po numerze części (zgłoszenie 2026-11-16: daty
 * tylko „gdy znają je wszystkie gry” → rok sklepu GOG dla reszty: HoMM V przed III); bez żadnej daty z IGDB — rok
 * wydania (gdy znają go wszystkie gry), inaczej numer części; potem numer, data tego wydania i tytuł.
 */
export function orderSeries(members: Game[], prefs: SeriesPrefs | undefined): Game[] {
  const known = members.filter((g) => (igdbOf(g)?.order ?? 0) > 0)
  // numer części tylko z tytułu, który zaczyna się od nazwy serii („BioShock Infinite” w serii BioShock nie jest
  // częścią 1 — code review 2026-11-16: fałszywa jedynka przestawiała kolejność)
  const num = (g: Game): number => {
    const p = parseSeries(g.name)
    const s = seriesOf(g, prefs)
    return p.num !== undefined && (!s || seriesKey(p.base) === seriesKey(s.name)) ? p.num : UNKNOWN
  }
  let when: (g: Game) => number
  if (known.length) {
    // numer części → data: najpóźniejsza znana część o numerze nie większym (+1 s), inaczej tuż przed najwcześniejszą
    const byNum = known.filter((g) => num(g) !== UNKNOWN).map((g) => ({ n: num(g), t: igdbOf(g)!.order }))
    const first = Math.min(...known.map((g) => igdbOf(g)!.order))
    when = (g) => {
      const ig = igdbOf(g)
      if (ig && ig.order > 0) return yearOfTs(ig.order)
      const n = num(g)
      if (n === UNKNOWN) return UNKNOWN
      const below = byNum.filter((x) => x.n <= n)
      return yearOfTs(below.length ? Math.max(...below.map((x) => x.t)) : first)
    }
  } else {
    const allYears = members.every((g) => yearOf(g) !== undefined)
    when = (g) => (allYears ? (yearOf(g) as number) : num(g))
  }
  const key = (g: Game): [number, number, number, number] => [
    prefs?.[g.id]?.order ?? UNKNOWN,
    when(g),
    num(g),
    igdbOf(g)?.release || yearOf(g) || UNKNOWN
  ]
  return members
    .map((g, i) => ({ g, k: key(g), i }))
    .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2] || a.k[3] - b.k[3] || a.i - b.i)
    .map((x) => x.g)
}

/** nazwa do sortowania — jak sortName gry Steam (main/library/merge.ts sortKey) */
export function nameSortKey(name: string): string {
  return name
    .replace(/^(the|a|an)\s+/i, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/** Nazwa serii jako klucz sortowania w stylu sortName jej gry — źródła liczą go różnie (Steam: bez znaków
 * diakrytycznych; emulatory: małe litery bez przedimka; GOG: małe litery), a seria ma stać między ich tytułami. */
function sortLike(g: Game, name: string): string {
  const styles: ((n: string) => string)[] = [
    nameSortKey,
    (n) => n.toLowerCase().replace(/^(the|a|an)\s+/, '').trim(),
    (n) => n.toLocaleLowerCase('pl')
  ]
  for (const f of styles) if (f(g.name) === g.sortName) return f(name)
  return name.toLocaleLowerCase('pl').replace(/^(the|a|an)\s+/, '')
}

const collator = new Intl.Collator('pl', { sensitivity: 'base' })

/** Nazwa serii do pokazania: nadana przez gracza, z IGDB, inaczej z tytułu pierwszej gry; nazwa z samych małych
 * liter (część kolekcji IGDB: „deus ex”) ustępuje zapisanej poprawnie — z tytułu gry tej serii. */
function blockName(arr: Game[], prefs: SeriesPrefs | undefined): string {
  for (const g of arr) if (prefs?.[g.id]?.name?.trim()) return prefs[g.id].name!.trim()
  let lower: string | undefined
  for (const g of arr) {
    const n = igdbOf(g)?.name?.trim()
    if (!n) continue
    if (n !== n.toLowerCase()) return n
    lower ??= n
  }
  if (lower) for (const g of arr) {
    const n = seriesOf(g, prefs)?.name
    if (n && n !== n.toLowerCase()) return n
  }
  return seriesOf(arr[0], prefs)?.name ?? arr[0].name
}

/** bloki serii listy (seria z co najmniej dwiema grami na tej liście) i klucz sortowania, pod którym blok stoi */
function seriesBlocks(sorted: Game[], prefs: SeriesPrefs | undefined): { blocks: { sk: string; games: Game[] }[]; inBlock: (g: Game) => boolean } {
  const groups = new Map<string, Game[]>()
  const keyByGame = new Map<Game, string>()
  for (const g of sorted) {
    const s = seriesOf(g, prefs)
    if (!s) continue
    keyByGame.set(g, s.key)
    const arr = groups.get(s.key)
    if (arr) arr.push(g)
    else groups.set(s.key, [g])
  }
  const blocks: { sk: string; games: Game[] }[] = []
  for (const arr of groups.values()) if (arr.length > 1) blocks.push({ sk: sortLike(arr[0], blockName(arr, prefs)), games: arr })
  const inBlock = (g: Game): boolean => (groups.get(keyByGame.get(g) ?? '')?.length ?? 0) > 1
  return { blocks, inBlock }
}

/** klucze, pod którymi `arrangeSeries` postawił bloki serii — dla listy, którą zwrócił (placedSeriesKeys) */
const placed = new WeakMap<Game[], Map<string, string>>()

/**
 * Klucz sortowania, pod którym `arrangeSeries` postawił grę tej listy (gra w bloku serii — klucz nazwy serii, nie
 * własny tytuł: „Magicland Dizzy” stoi przy D). Dokładnie ten, którego lista użyła — nie liczony drugi raz.
 * `undefined`: lista nie pochodzi z `arrangeSeries` (np. „Ostatnio grane”). Skok po literach (tv/letters.ts).
 */
export function placedSeriesKeys(list: Game[]): Map<string, string> | undefined {
  return placed.get(list)
}

/**
 * Lista po tytule → gry jednej serii razem, pod nazwą serii (zgłoszenie 2026-11-16: Ultima stała przy „Akalabeth”,
 * Tomb Raider przy „Rise of the Tomb Raider”), w kolejności serii. Gry spoza serii (i serie z jedną grą na tej
 * liście) zostają, gdzie były. Scalanie dwóch posortowanych list — działa dla dziesiątek tysięcy gier.
 */
export function arrangeSeries(sorted: Game[], prefs: SeriesPrefs | undefined): Game[] {
  const { blocks, inBlock } = seriesBlocks(sorted, prefs)
  if (!blocks.length) {
    placed.set(sorted, new Map())
    return sorted
  }
  blocks.sort((a, b) => collator.compare(a.sk, b.sk))
  const keys = new Map<string, string>()
  for (const blk of blocks) for (const g of blk.games) keys.set(g.id, blk.sk)
  const out: Game[] = []
  let b = 0
  for (const g of sorted) {
    if (inBlock(g)) continue
    // seria przed grą, gdy jej nazwa jest wcześniej (albo równa — „Fallout” przed grą „Fallout Shelter” spoza serii)
    while (b < blocks.length && collator.compare(blocks[b].sk, g.sortName) <= 0) out.push(...orderSeries(blocks[b++].games, prefs))
    out.push(g)
  }
  while (b < blocks.length) out.push(...orderSeries(blocks[b++].games, prefs))
  placed.set(out, keys)
  return out
}

/** Gry tej samej serii co `game` (ta sama platforma) w całej bibliotece, w kolejności serii (okno „Seria”). */
export function seriesMembers(game: Game, all: Game[], prefs: SeriesPrefs | undefined): Game[] {
  const s = seriesOf(game, prefs)
  if (!s) return [game]
  return orderSeries(
    all.filter((g) => g.id === game.id || seriesOf(g, prefs)?.key === s.key),
    prefs
  )
}

/** Serie istniejące na platformie gry (do wyboru w oknie „Seria”): nazwa, grupa, liczba gier — po nazwie. */
export function seriesOnScope(game: Game, all: Game[], prefs: SeriesPrefs | undefined): { name: string; group?: string; count: number }[] {
  const scope = seriesScope(game)
  const by = new Map<string, { games: Game[]; group?: string }>()
  for (const g of all) {
    if (seriesScope(g) !== scope) continue
    const s = seriesOf(g, prefs)
    if (!s) continue
    const e = by.get(s.key)
    if (e) {
      e.games.push(g)
      e.group ??= s.group
    } else by.set(s.key, { games: [g], group: s.group })
  }
  const out: { name: string; group?: string; count: number }[] = []
  for (const e of by.values()) {
    // seria z jedną grą to dopiero kandydat — chyba że nadał ją gracz (nowa seria, do której dołączy następne)
    if (e.games.length < 2 && !prefs?.[e.games[0].id]?.name) continue
    out.push({ name: blockName(e.games, prefs), ...(e.group ? { group: e.group } : {}), count: e.games.length })
  }
  return out.sort((a, b) => collator.compare(nameSortKey(a.name), nameSortKey(b.name)))
}

/** Grupy (franczyzy i nadane przez gracza) na platformie gry — do wyboru w oknie „Seria”. */
export function groupsOnScope(game: Game, all: Game[], prefs: SeriesPrefs | undefined): string[] {
  const scope = seriesScope(game)
  const seen = new Map<string, string>()
  for (const g of all) {
    if (seriesScope(g) !== scope) continue
    const gr = seriesOf(g, prefs)?.group
    if (gr && !seen.has(seriesKey(gr))) seen.set(seriesKey(gr), gr)
  }
  return [...seen.values()].sort((a, b) => collator.compare(nameSortKey(a), nameSortKey(b)))
}

/** Gra o jedno miejsce wcześniej / później: całej serii nadane miejsca w obecnej kolejności, z zamianą sąsiadów. */
export function moveInSeries(members: Game[], id: string, dir: -1 | 1, prefs: SeriesPrefs | undefined): SeriesPrefs | null {
  const i = members.findIndex((g) => g.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= members.length) return null
  const order = members.map((g) => g.id)
  ;[order[i], order[j]] = [order[j], order[i]]
  const next: SeriesPrefs = {}
  order.forEach((gid, k) => {
    next[gid] = { ...prefs?.[gid], order: k + 1 }
  })
  return next
}

/** Wybór gracza → poprawny (z pliku preferencji: wszystko spoza zakresu odrzucone). */
export function cleanSeriesPrefs(raw: unknown): SeriesPrefs {
  const out: SeriesPrefs = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [id, v] of Object.entries(raw as Record<string, unknown>).slice(0, 50_000)) {
    if (!v || typeof v !== 'object' || id.length > 200) continue
    const r = v as Record<string, unknown>
    const p: SeriesPref = {}
    if (typeof r.name === 'string' && r.name.trim()) p.name = r.name.trim().slice(0, 120)
    if (r.none === true) p.none = true
    if (typeof r.order === 'number' && Number.isFinite(r.order)) p.order = Math.max(-1e6, Math.min(1e6, Math.round(r.order)))
    if (typeof r.group === 'string' && r.group.trim()) p.group = r.group.trim().slice(0, 120)
    if (p.name || p.none || p.order !== undefined || p.group) out[id] = p
  }
  return out
}
