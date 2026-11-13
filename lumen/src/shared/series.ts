import type { Game } from './types'

// Serie gier: na listach po tytule gry jednej serii stoją razem — w miejscu pierwszej z nich, w kolejności wydania
// (wybór gracza 2026-11-13: „obok siebie w sortowaniu”). Seria rozpoznawana po tytule; gracz może ją poprawić
// (Opcje gry → Seria), a jego wybór zostaje w preferencjach (prefs.series). Czyste funkcje — tests/series.test.ts.

/** Wybór gracza dla jednej gry: inna nazwa serii, „nie należy do serii”, miejsce w serii. */
export interface SeriesPref {
  /** nazwa serii nadana przez gracza (gra dołącza do każdej gry z tą samą nazwą, rozpoznanej albo nadanej) */
  name?: string
  /** gra nie należy do żadnej serii */
  none?: boolean
  /** miejsce w serii ustawione przez gracza (mniejsze — wcześniej) */
  order?: number
}

export type SeriesPrefs = Record<string, SeriesPref>

const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12, xiii: 13 }
const MARKS = /[™®©]/g

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

function parseTitle(title: string): { base: string; num?: number } {
  const t = title.replace(MARKS, '').replace(/\s*[([][^)\]]*[)\]]\s*$/, '').trim()
  // część przed podtytułem: „Seria: podtytuł”, „Seria - podtytuł”
  const head = t.split(/\s*:\s+|\s+[-–—]\s+/)[0].trim()
  const m = /^(.*?\S)\s+(?:(?:part|episode|chapter|vol\.?|volume)\s+)?(\d{1,4}|[ivx]{1,4})$/i.exec(head)
  if (m) {
    const n = /^\d+$/.test(m[2]) ? Number(m[2]) : ROMAN[m[2].toLowerCase()]
    if (n !== undefined) return { base: m[1].replace(/[\s:,-]+$/, ''), num: n }
  }
  return head === t ? { base: head, num: 1 } : { base: head }
}

/** Klucz serii: bez wielkości liter, przedimka „The” i znaków przestankowych. */
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
    .replace(/^the\s+/, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Seria gry: nazwa (do pokazania), klucz i numer części — albo nic (gracz wyłączył albo tytuł nic nie mówi). */
type Found = { key: string; name: string; num?: number } | undefined
/** seria rozpoznana z tytułu (bez wyboru gracza), przy obiekcie gry — ważna, dopóki tytuł ten sam */
const autoCache = new WeakMap<Game, { title: string; found: Found }>()

export function seriesOf(g: Game, prefs: SeriesPrefs | undefined): Found {
  const p = prefs?.[g.id]
  if (!p) {
    const hit = autoCache.get(g)
    if (hit && hit.title === g.name) return hit.found
    const found = findSeries(g, undefined)
    autoCache.set(g, { title: g.name, found })
    return found
  }
  return findSeries(g, p)
}

function findSeries(g: Game, p: SeriesPref | undefined): Found {
  if (p?.none) return undefined
  const parsed = parseSeries(g.name)
  const name = p?.name?.trim() || parsed.base
  const key = seriesKey(name)
  // jedna litera albo samo „The” to nie seria; własna nazwa gracza — zawsze
  if (!p?.name && key.replace(/\s/g, '').length < 3) return undefined
  return { key, name, ...(parsed.num !== undefined ? { num: parsed.num } : {}) }
}

export const yearOf = (g: Game): number | undefined => {
  const y = parseInt(g.emu?.year || g.facts?.year || '', 10)
  return y > 1900 && y < 3000 ? y : undefined
}

/**
 * Kolejność w serii: miejsce ustawione przez gracza, potem rok wydania (gdy znają go wszystkie gry serii), potem
 * numer części z tytułu, potem rok i tytuł. Zawsze ten sam porządek klucza — porównanie jest przechodnie.
 */
export function orderSeries(members: Game[], prefs: SeriesPrefs | undefined): Game[] {
  const allYears = members.every((g) => yearOf(g) !== undefined)
  const key = (g: Game): [number, number, number, number] => {
    const own = prefs?.[g.id]?.order
    const y = yearOf(g) ?? Number.MAX_SAFE_INTEGER
    const n = parseSeries(g.name).num ?? Number.MAX_SAFE_INTEGER
    return [own ?? Number.MAX_SAFE_INTEGER, allYears ? y : n, allYears ? n : y, 0]
  }
  return members
    .map((g, i) => ({ g, k: key(g), i }))
    .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2] || a.i - b.i)
    .map((x) => x.g)
}

/**
 * Lista po tytule → gry jednej serii razem, w miejscu pierwszej z nich, w kolejności wydania. Gry spoza serii
 * (i serie z jedną grą na tej liście) zostają, gdzie były. Jedno przejście — działa dla dziesiątek tysięcy gier.
 */
export function arrangeSeries(sorted: Game[], prefs: SeriesPrefs | undefined): Game[] {
  const groups = new Map<string, Game[]>()
  const keyOf = new Map<Game, string>()
  for (const g of sorted) {
    const s = seriesOf(g, prefs)
    if (!s) continue
    keyOf.set(g, s.key)
    const arr = groups.get(s.key)
    if (arr) arr.push(g)
    else groups.set(s.key, [g])
  }
  let any = false
  for (const arr of groups.values()) if (arr.length > 1) any = true
  if (!any) return sorted
  const out: Game[] = []
  const placed = new Set<string>()
  for (const g of sorted) {
    const k = keyOf.get(g)
    const arr = k === undefined ? undefined : groups.get(k)
    if (!arr || arr.length < 2) out.push(g)
    else if (!placed.has(k!)) {
      placed.add(k!)
      out.push(...orderSeries(arr, prefs))
    }
  }
  return out
}

/** Gry tej samej serii co `game` w całej bibliotece, w kolejności serii (do „Opcji gry” → Seria). */
export function seriesMembers(game: Game, all: Game[], prefs: SeriesPrefs | undefined): Game[] {
  const s = seriesOf(game, prefs)
  if (!s) return [game]
  return orderSeries(
    all.filter((g) => g.id === game.id || seriesOf(g, prefs)?.key === s.key),
    prefs
  )
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
    if (p.name || p.none || p.order !== undefined) out[id] = p
  }
  return out
}
