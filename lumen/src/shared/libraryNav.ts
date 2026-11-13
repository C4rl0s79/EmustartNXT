import type { Category, EmuSystem, Game, GamePlatform, PlatformFamily, PlatformInfo, Prefs, SteamCollection } from './types'
import { arrangeSeries } from './series'

// One navigation model for both layouts (desktop tabs + chips, TV carousels):
//   PC → Wszystkie / Steam / GOG / Skróty
//   Komputery, Konsole, Arcade, Pozostałe → Wszystkie / one subgroup per platform
//   Kolekcje (Lumen categories and Steam collections), Ulubione, Ostatnio grane
// The family is separate from the source: a Steam shortcut that starts an emulator is not a PC game,
// a GOG game is. Lists come from the library and EmuStart's system catalog — never a fixed short list.

export const FAMILY_LABEL: Record<PlatformFamily, string> = {
  pc: 'PC',
  computer: 'Komputery',
  console: 'Konsole',
  arcade: 'Arcade',
  other: 'Pozostałe'
}
export const FAMILY_ORDER: PlatformFamily[] = ['pc', 'computer', 'console', 'arcade', 'other']

/** exe names of emulators: a shortcut starting one is not a native PC game */
const EMULATOR_EXE =
  /(^|[\\/])(retroarch|pcsx2[\w-]*|dolphin|duckstation[\w-]*|ppsspp\w*|cemu|yuzu|ryujinx|suyu|sudachi|rpcs3|xemu|xenia[\w-]*|mame\w*|mednafen|fs-uae|winuae\w*|x64sc|x64|xvic|citra[\w-]*|lime3ds\w*|melonds|desmume\w*|mgba\w*|snes9x\w*|bsnes\w*|higan|ares|epsxe\w*|redream|flycast|demul|project64|simple64[\w-]*|mupen64\w*|vita3k|stella|hatari\w*|steem\w*|fuse|openmsx|bluemsx|blastem|kega\w*|fceux\w*|mesen\w*|nestopia|vba\w*|visualboyadvance[\w-]*|scummvm|dosbox[\w-]*|86box|pcem|play)\.exe$/i

export interface ClassifyContext {
  /** EmuStart platforms of the server library (display name, family) */
  systems: Map<string, { display: string; family?: PlatformFamily }>
  /** every known platform (EmuStart's system catalog) */
  catalog: PlatformInfo[]
  /** prefs.platformOverrides */
  overrides: Record<string, string>
}

export function classifyContext(systems: EmuSystem[], catalog: PlatformInfo[], overrides: Record<string, string>): ClassifyContext {
  return { systems: new Map(systems.map((s) => [s.es, { display: s.display, family: s.family }])), catalog, overrides }
}

const norm = (s: string): string => s.trim().toLowerCase().replace(/[\s_-]+/g, '')

function platformOf(es: string, ctx: ClassifyContext): GamePlatform {
  const sys = ctx.systems.get(es)
  const cat = ctx.catalog.find((p) => p.es === es) ?? ctx.catalog.find((p) => p.es.toLowerCase() === es.toLowerCase())
  const family: PlatformFamily = sys?.family ?? cat?.family ?? 'other'
  return { family, id: `emu:${cat?.es ?? es}`, label: sys?.display ?? cat?.display ?? es }
}

/** A Steam tag that names a platform ("PS2", "PlayStation 2", "ps2", "Amiga") → its catalog entry. */
export function platformForTag(tag: string, catalog: PlatformInfo[]): PlatformInfo | undefined {
  const t = norm(tag)
  if (!t) return undefined
  return catalog.find((p) => norm(p.es) === t) ?? catalog.find((p) => norm(p.plat) === t) ?? catalog.find((p) => norm(p.display) === t)
}

/** Family and subgroup of a game. Never merges by title; never turns the source into a category. */
export function classify(game: Game, ctx: ClassifyContext): GamePlatform {
  if (game.source === 'gog') return { family: 'pc', id: 'gog', label: 'GOG' }
  if (game.source === 'steam' || game.source === 'demo') return { family: 'pc', id: 'steam', label: 'Steam' }
  if (game.source === 'emustart' && game.emu) return platformOf(game.emu.es, ctx)
  if (game.source === 'shortcut') {
    const o = ctx.overrides[game.id]
    if (o === 'pc') return { family: 'pc', id: 'shortcut', label: 'Skróty Steam', manual: true }
    if (o === 'other') return { family: 'other', id: 'other:shortcut', label: 'Nieznana platforma', manual: true }
    if (o?.startsWith('emu:')) return { ...platformOf(o.slice(4), ctx), manual: true }
    for (const tag of game.shortcut?.tags ?? []) {
      const p = platformForTag(tag, ctx.catalog)
      if (p) return platformOf(p.es, ctx)
    }
    // starts an emulator, platform unknown: "Pozostałe" until the player assigns one
    if (EMULATOR_EXE.test(game.shortcut?.exe ?? '')) return { family: 'other', id: 'other:shortcut', label: 'Nieznana platforma' }
    return { family: 'pc', id: 'shortcut', label: 'Skróty Steam' }
  }
  return { family: 'other', id: 'other:unknown', label: 'Nieznana platforma' }
}

/** Is the shortcut's platform a guess the player may want to correct (shown in its details)? */
export function canReassign(game: Game): boolean {
  return game.source === 'shortcut'
}

// ---------- navigation tree ----------

export interface NavSub {
  /** stable id: '<group>/all', '<group>/<platform id>', 'col/<category id>' — also the pin id */
  id: string
  label: string
  games: Game[]
  /** EmuStart platform of this subgroup (logo, console photo in the TV carousel) */
  es?: string
}

export interface NavGroup {
  id: PlatformFamily | 'col' | 'fav' | 'recent'
  label: string
  subs: NavSub[]
  games: Game[]
}

// one collator for all sorts: localeCompare(…, 'pl', options) is ~60× slower — 40 tys. gier ≈ 0,7 s na sortowanie
const collator = new Intl.Collator('pl', { sensitivity: 'base' })
export const compareText = (a: string, b: string): number => collator.compare(a, b)
export const byName = (a: Game, b: Game): number => collator.compare(a.sortName, b.sortName)

const PC_ORDER = ['steam', 'gog', 'shortcut']
const PC_LABEL: Record<string, string> = { steam: 'Steam', gog: 'GOG', shortcut: 'Skróty Steam' }

/** Games of a Lumen category or a Steam collection (no smart categories — they became fixed groups). */
export function collectionGames(cat: Category, games: Game[], prefs: Prefs, collections: SteamCollection[] | null): Game[] {
  if (cat.kind === 'steam') {
    const col = collections?.find((c) => c.id === cat.steamCollectionId)
    if (!col) return []
    const ids = new Set(col.appIds)
    return games.filter((g) => (g.source === 'steam' || g.source === 'shortcut') && ids.has(g.appId))
  }
  if (cat.kind === 'custom') return games.filter((g) => prefs.gameCategories[g.id]?.includes(cat.id))
  return []
}

/**
 * The library tree. Empty subgroups and empty families are left out (an unknown platform still shows up,
 * under Pozostałe). Every game keeps its one record — groups only reference it.
 */
export function buildNav(games: Game[], prefs: Prefs, collections: SteamCollection[] | null, recentLimit = 40): NavGroup[] {
  const out: NavGroup[] = []
  const fam = new Map<PlatformFamily, Map<string, NavSub>>()
  for (const g of games) {
    const p = g.platform
    if (!p) continue
    let subs = fam.get(p.family)
    if (!subs) fam.set(p.family, (subs = new Map()))
    let sub = subs.get(p.id)
    if (!sub) {
      sub = { id: `${p.family}/${p.id}`, label: p.family === 'pc' ? (PC_LABEL[p.id] ?? p.label) : p.label, games: [], ...(p.id.startsWith('emu:') ? { es: p.id.slice(4) } : {}) }
      subs.set(p.id, sub)
    }
    sub.games.push(g)
  }
  for (const f of FAMILY_ORDER) {
    const subs = fam.get(f)
    if (!subs?.size) continue
    const list = [...subs.values()]
    // po tytule, a gry jednej serii razem, w kolejności wydania (shared/series.ts)
    for (const s of list) s.games = arrangeSeries(s.games.sort(byName), prefs.series)
    if (f === 'pc') list.sort((a, b) => PC_ORDER.indexOf(a.id.slice(3)) - PC_ORDER.indexOf(b.id.slice(3)))
    else list.sort((a, b) => compareText(a.label, b.label))
    const all = arrangeSeries(list.flatMap((s) => s.games).sort(byName), prefs.series)
    out.push({ id: f, label: FAMILY_LABEL[f], games: all, subs: [{ id: `${f}/all`, label: 'Wszystkie', games: all }, ...list] })
  }
  const cols = [...prefs.categories]
    .filter((c) => c.kind === 'custom' || c.kind === 'steam')
    .sort((a, b) => a.order - b.order)
    .map((c) => ({ id: `col/${c.id}`, label: c.name, games: arrangeSeries(collectionGames(c, games, prefs, collections).sort(byName), prefs.series) }))
    .filter((s) => s.games.length)
  if (cols.length) out.push({ id: 'col', label: 'Kolekcje', subs: cols, games: [] })
  const favIds = new Set(prefs.favorites)
  const favs = arrangeSeries(games.filter((g) => favIds.has(g.id)).sort(byName), prefs.series)
  out.push({ id: 'fav', label: 'Ulubione', subs: [{ id: 'fav/all', label: 'Ulubione', games: favs }], games: favs })
  const recent = games.filter((g) => g.lastPlayed).sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0)).slice(0, recentLimit)
  if (recent.length) out.push({ id: 'recent', label: 'Ostatnio grane', subs: [{ id: 'recent/all', label: 'Ostatnio grane', games: recent }], games: recent })
  return out
}

/** A subgroup by its (pin) id, with its group. */
export function findSub(nav: NavGroup[], id: string): { group: NavGroup; sub: NavSub } | undefined {
  for (const group of nav) {
    const sub = group.subs.find((s) => s.id === id)
    if (sub) return { group, sub }
  }
  return undefined
}

/** Label of a pinned subgroup: "Konsole › PlayStation 2", "PC › GOG", the collection's name. */
export function subTitle(group: NavGroup, sub: NavSub): string {
  if (group.id === 'col' || group.id === 'fav' || group.id === 'recent') return sub.label
  return sub.id.endsWith('/all') ? group.label : `${sub.label}`
}

/** Pinned subgroups that exist now, in the player's order (a pin of a platform gone from the library is kept, not shown). */
export function pinnedSubs(nav: NavGroup[], pins: string[]): { group: NavGroup; sub: NavSub }[] {
  return pins.map((id) => findSub(nav, id)).filter((x): x is { group: NavGroup; sub: NavSub } => !!x)
}
