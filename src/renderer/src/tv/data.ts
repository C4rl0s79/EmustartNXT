import { useMemo } from 'react'
import type { EmuSystem, Game } from '@shared/types'
import type { NavGroup, NavSub } from '@shared/libraryNav'
import { useStore } from '../store'
import { plural } from '../lib/format'
import { pinLabel, useNav, usePinned } from '../lib/nav'

// Systems and their games for the TV layout — computed from the same library as the desktop
// layout (one interface, two layouts): EmuStart platforms from the engine, Steam as one more system.

export const STEAM = 'steam'

export interface TvSystem {
  key: string
  display: string
  games: Game[]
  /** downloaded (EmuStart cache) / installed (Steam) */
  ready: number
  emulator?: string
  /** platform logo from the EmuStart server (lumen-art: emusys:<es>) */
  logo: boolean
  /** photo of the platform's console from the server (lumen-art: emusys:<es> / hero) */
  console?: { credit: string; lum: number }
  /** versions of the logo / console photo (EmuSystem.logoRev / consoleRev) — part of their addresses */
  logoRev: number
  consoleRev: number
  /** pixel-art logo (EmuSystem.logoPixel): size of an art pixel in file pixels; 0 — an ordinary logo */
  logoPixel: number
  /** EmuStart platform of this item (logo, console photo, description, system options); absent = a library group */
  es?: string
  /** description under the carousel for a library group (PC, Konsole, GOG…) */
  about?: string
  /** hierarchy item: a group with its subgroups, or one subgroup */
  group?: NavGroup
  sub?: NavSub
}

/** "66 gier · 12 w pamięci podręcznej · RetroArch: Opera" — like EmuStart's carousel */
export function systemMeta(s: TvSystem): string {
  const n = s.games.length
  let t = `${n} ${plural(n, 'gra', 'gry', 'gier')}`
  if (s.key === STEAM) return t + (s.ready ? ` · ${s.ready} zainstalowanych` : '') + ' · klient Steam'
  if (!s.es && s.group) {
    // a library group (PC, Konsole, GOG, a collection…)
    if (s.ready) t += ` · ${s.ready} gotowych do gry`
    if (!s.sub && s.group.subs.length > 1) t += ` · ${s.group.subs.length - 1} ${plural(s.group.subs.length - 1, 'podgrupa', 'podgrupy', 'podgrup')}`
    return t
  }
  if (s.ready) t += ` · ${s.ready} w pamięci podręcznej`
  t += s.emulator ? ` · ${s.emulator}` : ' · brak emulatora'
  return t
}

const ABOUT: Record<string, string> = {
  pc: 'Gry na PC: Steam, GOG z serwera EmuStart i skróty Steam do gier spoza sklepu.',
  computer: 'Komputery domowe: Amiga, Commodore 64, ZX Spectrum, Atari ST i inne — gry z serwera EmuStart i skróty.',
  console: 'Konsole stacjonarne i przenośne.',
  arcade: 'Automaty: MAME, FinalBurn Neo, Neo Geo.',
  other: 'Platformy, których Lumen nie rozpoznał — w szczegółach skrótu Steam możesz wskazać platformę.',
  col: 'Twoje kategorie Lumen i kolekcje Steam.',
  fav: 'Gry oznaczone gwiazdką.',
  recent: 'Ostatnio uruchamiane gry.',
  'pc/gog': 'Gry GOG z archiwum depotów na serwerze EmuStart — instalacja wprost z serwera, uruchamianie bez serwera.',
  'pc/shortcut': 'Skróty Steam do gier spoza sklepu Steam.'
}

function readyCount(games: Game[]): number {
  return games.filter((g) => (g.emu ? g.emu.cached : g.installed)).length
}

/** One subgroup as a carousel item — an EmuStart platform keeps its logo, console photo and options. */
export function subItem(group: NavGroup, sub: NavSub, systems: EmuSystem[], display?: string): TvSystem {
  const games = sub.games
  const base = { games, ready: readyCount(games), logoRev: 0, consoleRev: 0, logoPixel: 0, group, sub }
  if (sub.es) {
    const s = systems.find((x) => x.es === sub.es)
    return {
      ...base,
      key: sub.es,
      es: sub.es,
      display: display ?? sub.label,
      emulator: s?.emulator,
      logo: !!s?.hasLogo,
      logoRev: s?.logoRev ?? 0,
      consoleRev: s?.consoleRev ?? 0,
      logoPixel: s?.logoPixel ?? 0,
      ...(s?.hasConsole ? { console: { credit: s.consoleCredit ?? '', lum: s.consoleLum ?? 0.5 } } : {})
    }
  }
  if (sub.id === 'pc/steam') return { ...base, key: STEAM, display: display ?? 'Steam', logo: false }
  return { ...base, key: sub.id, display: display ?? sub.label, logo: false, about: ABOUT[sub.id] ?? ABOUT[group.id] }
}

/** A family / fixed group as the first carousel level (enter → its subgroups). */
export function groupItem(group: NavGroup): TvSystem {
  return { key: `grp:${group.id}`, display: group.label, games: group.games, ready: readyCount(group.games), logo: false, logoRev: 0, consoleRev: 0, logoPixel: 0, about: ABOUT[group.id], group }
}

/** TV: first level = pinned subgroups, then PC / Komputery / Konsole / Arcade / Pozostałe / Kolekcje / Ulubione / Ostatnio grane. */
export function useTvNav(): { top: TvSystem[]; nav: NavGroup[] } {
  const nav = useNav()
  const pinned = usePinned(nav)
  const systems = useStore((s) => s.snapshot?.emustart?.systems)
  return useMemo(() => {
    const top = [
      ...pinned.map((p) => ({ ...subItem(p.group, p.sub, systems ?? [], pinLabel(p.group, p.sub)), key: `pin:${p.sub.id}` })),
      ...nav.filter((g) => g.games.length || g.id === 'fav').map(groupItem)
    ]
    return { top, nav }
  }, [nav, pinned, systems])
}
