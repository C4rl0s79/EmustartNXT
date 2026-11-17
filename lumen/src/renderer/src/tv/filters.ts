import type { Game, GameRatings } from '@shared/types'
import { compareText } from '@shared/libraryNav'

// Game list filters of a library group — EmuStart's filters (engine/web/options.js: FL) for Lumen's
// games: search in the title, genre, decade, players, region, developer, what to show and the
// order. One record per group, read by the desktop and the TV layout alike (filterId). Pure functions —
// tested in tests/tv.test.ts.

export interface Filter {
  q: string
  genre: string
  decade: string
  players: number
  region: string
  dev: string
  show: 'all' | 'local' | 'notlocal' | 'pinned' | 'fav' | 'played' | 'unplayed'
  sort: 'title' | 'year' | 'last' | 'added' | 'time' | 'size' | RatingSort
}

/** sorting by a rating: LaunchBox community, critics (Metacritic), players (Steam reviews) */
export type RatingSort = 'launchbox' | 'critic' | 'players'
export const RATING_SORTS: readonly RatingSort[] = ['launchbox', 'critic', 'players']
export const isRatingSort = (s: Filter['sort']): s is RatingSort => (RATING_SORTS as readonly string[]).includes(s)

export const FILTER_DEFAULT: Filter = { q: '', genre: '', decade: '', players: 0, region: '', dev: '', show: 'all', sort: 'title' }

export const SORT: Record<Filter['sort'], string> = {
  title: 'tytuł',
  year: 'rok premiery',
  last: 'ostatnio grane',
  added: 'nowo dodane',
  time: 'czas gry',
  size: 'rozmiar',
  launchbox: 'ocena LaunchBox',
  critic: 'ocena krytyków (Metacritic)',
  players: 'ocena graczy (recenzje Steam)'
}
export const PLAYERS: Record<number, string> = { 0: 'dowolna', 1: '1 gracz', 2: '2 i więcej', 3: '3 i więcej', 4: '4 i więcej' }
/** "local": EmuStart — in the game cache, Steam — installed */
export function showLabels(steam: boolean): Record<Filter['show'], string> {
  return {
    all: 'wszystkie',
    local: steam ? 'tylko zainstalowane' : 'tylko lokalne (w cache)',
    notlocal: steam ? 'tylko niezainstalowane' : 'tylko poza cache',
    pinned: 'tylko zachowane na dysku',
    fav: 'tylko ulubione',
    played: 'grane',
    unplayed: 'niegrane'
  }
}

export type FilterKey = 'genre' | 'decade' | 'region' | 'dev'

/** the filter uses data PC games get on demand (tv/facts.ts) */
export const needsFacts = (f: Filter): boolean => !!(f.genre || f.decade || f.players || f.dev || f.sort === 'year')

const decadeOf = (y?: string): string => (/^\d{4}/.test(y ?? '') ? y!.slice(0, 3) + '0' : '')
const yearOf = (g: Game): string | undefined => g.emu?.year || g.facts?.year
const devOf = (g: Game): string => (g.emu ? (g.emu.developer ?? '').split(/,\s*/)[0] : g.facts?.developer) ?? ''
const genresOf = (g: Game): string[] => (g.emu ? (g.emu.genre ?? '').split(/,\s*/).filter(Boolean) : (g.facts?.genres ?? []))
const playersOf = (g: Game): number => (g.emu ? parseInt(g.emu.players ?? '', 10) : g.facts?.players) || 0

/** Regions of a No-Intro / Redump name: "(USA, Europe)" → USA, Europe */
export function regionsOf(g: Game): string[] {
  const tags = g.emu?.tags ?? ''
  const first = /\(([^)]+)\)/.exec(tags)?.[1] ?? ''
  const known = /^(USA|Europe|Japan|World|Asia|Korea|China|Taiwan|Australia|Brazil|Canada|France|Germany|Italy|Spain|Netherlands|Sweden|Scandinavia|UK|Poland|Russia)$/i
  return first
    .split(/,\s*/)
    .map((x) => x.trim())
    .filter((x) => known.test(x))
}

export function matches(g: Game, f: Filter, fav: (id: string) => boolean, skip?: keyof Filter): boolean {
  if (skip !== 'q' && f.q && !`${g.name} ${g.emu?.tags ?? ''}`.toLowerCase().includes(f.q.toLowerCase())) return false
  if (skip !== 'genre' && f.genre && !genresOf(g).includes(f.genre)) return false
  if (skip !== 'decade' && f.decade && decadeOf(yearOf(g)) !== f.decade) return false
  if (skip !== 'players' && f.players && playersOf(g) < f.players) return false
  if (skip !== 'region' && f.region && !regionsOf(g).includes(f.region)) return false
  if (skip !== 'dev' && f.dev && devOf(g) !== f.dev) return false
  if (skip !== 'show') {
    const local = g.emu ? g.emu.cached : g.installed
    if (f.show === 'local' && !local) return false
    if (f.show === 'notlocal' && local) return false
    if (f.show === 'pinned' && !g.emu?.pinned) return false
    if (f.show === 'fav' && !fav(g.id)) return false
    if (f.show === 'played' && !g.lastPlayed) return false
    if (f.show === 'unplayed' && g.lastPlayed) return false
  }
  return true
}

/** Filtered and sorted games (title order is the list's own). Rating sorts: highest first, games without one last. */
export function apply(all: Game[], f: Filter, fav: (id: string) => boolean, ratings: Record<string, GameRatings> = {}): Game[] {
  const out = all.filter((g) => matches(g, f, fav))
  const size = (g: Game): number => g.emu?.size ?? g.sizeOnDisk ?? 0
  const name = (a: Game, b: Game): number => compareText(a.sortName, b.sortName)
  const by: Partial<Record<Filter['sort'], (a: Game, b: Game) => number>> = {
    year: (a, b) => (yearOf(a) || '9999').localeCompare(yearOf(b) || '9999') || a.name.localeCompare(b.name),
    last: (a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0) || name(a, b),
    added: (a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0) || name(a, b),
    time: (a, b) => (b.playtimeMinutes ?? -1) - (a.playtimeMinutes ?? -1) || name(a, b),
    size: (a, b) => size(b) - size(a)
  }
  if (isRatingSort(f.sort)) {
    const key = f.sort
    const r = (g: Game): number => ratings[g.id]?.[key] ?? -1
    by[key] = (a, b) => r(b) - r(a) || a.name.localeCompare(b.name)
  }
  const cmp = by[f.sort]
  return cmp ? out.sort(cmp) : out
}

/** How many games remain with `key` set to `val` (the other filters kept). */
export function countWith<K extends keyof Filter>(all: Game[], f: Filter, key: K, val: Filter[K], fav: (id: string) => boolean): number {
  const g = { ...f, [key]: val }
  return all.filter((x) => matches(x, g, fav)).length
}

/** Values of a field among the games the other filters leave, most frequent first (decades in order). */
export function valuesOf(all: Game[], f: Filter, key: FilterKey, fav: (id: string) => boolean): [string, number][] {
  const counts = new Map<string, number>()
  for (const g of all) {
    if (!matches(g, f, fav, key)) continue
    const vals = key === 'genre' ? genresOf(g) : key === 'decade' ? [decadeOf(yearOf(g))] : key === 'region' ? regionsOf(g) : [devOf(g)]
    for (const v of new Set(vals.filter(Boolean))) counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  const arr = [...counts.entries()]
  arr.sort(key === 'decade' ? (a, b) => a[0].localeCompare(b[0]) : (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return arr
}

/** Active filters in words (shown above the list): „mario”, Platformówka, 1990s… */
export function activeParts(f: Filter, steam: boolean): string[] {
  const out: string[] = []
  if (f.q) out.push(`„${f.q}”`)
  if (f.genre) out.push(f.genre)
  if (f.decade) out.push(`${f.decade}s`)
  if (f.players) out.push(PLAYERS[f.players])
  if (f.region) out.push(f.region)
  if (f.dev) out.push(f.dev)
  if (f.show !== 'all') out.push(showLabels(steam)[f.show])
  return out
}

const KEY = (id: string): string => `lumen.filter.${id}`

/**
 * id of a group's filters, the same in both views: the library subgroup ('console/emu:snes', 'pc/gog', 'col/…');
 * a whole group on the TV carousel (Ulubione, Ostatnio grane…) — its "Wszystkie" subgroup ('fav/all')
 */
export function filterId(sub: { id: string } | undefined, group: { id: string } | undefined, fallback: string): string {
  return sub?.id ?? (group ? `${group.id}/all` : fallback)
}

/** a desktop view's own install filter and order, kept apart until Lumen 1.0.75 */
const OLD_DESKTOP_SHOW: Record<string, Filter['show']> = { installed: 'local', notInstalled: 'notlocal' }
const OLD_DESKTOP_SORT: Record<string, Filter['sort']> = { name: 'title', recent: 'last', added: 'added', playtime: 'time' }

function read(key: string): Partial<Filter> | null {
  const raw = localStorage.getItem(key)
  return raw === null ? null : (JSON.parse(raw) as Partial<Filter>)
}

/**
 * The group's filters. Until Lumen 1.0.75 each view kept its own; with no shared record yet the TV's comes first
 * (`tvKeys`: its old ids), then the desktop's (its window's filters, install filter and order).
 */
export function loadFilter(id: string, tvKeys: string[] = []): Filter {
  try {
    const own = read(KEY(id))
    if (own) return { ...FILTER_DEFAULT, ...own }
    for (const k of tvKeys) {
      const tv = read(KEY(k))
      if (tv) return { ...FILTER_DEFAULT, ...tv }
    }
    const desk = read(KEY(`group:nav:${id}`))
    const view = JSON.parse(localStorage.getItem(`lumen.group.nav:${id}`) ?? '{}') as { filter?: string; sort?: string }
    const f: Filter = { ...FILTER_DEFAULT, ...(desk ?? {}) }
    if (f.show === 'all' && view.filter && OLD_DESKTOP_SHOW[view.filter]) f.show = OLD_DESKTOP_SHOW[view.filter]
    if (f.sort === 'title' && view.sort && OLD_DESKTOP_SORT[view.sort]) f.sort = OLD_DESKTOP_SORT[view.sort]
    return f
  } catch {
    return { ...FILTER_DEFAULT }
  }
}
export function saveFilter(id: string, f: Filter): void {
  try {
    localStorage.setItem(KEY(id), JSON.stringify(f))
  } catch {
    /* no browser storage — the filter lasts until the program closes */
  }
}
