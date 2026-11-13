import { createContext, useContext } from 'react'
import type { ThemePackage } from '@shared/types'
import { layerSrc } from '../lib/themeLayers'
import { groupArtId } from './GroupArt'
import type { TvSystem } from './data'

// Domyślne grafiki kategorii z motywu z paczki (theme.json → categories, etap 14d). Klucz: grupa / podgrupa
// biblioteki jak w „Grafice grupy” (np. „pc”, „pc/steam”, „grp:konsole”) albo platforma EmuStart „es:<system>”;
// „@logo” na końcu — logo zamiast tła. Kolejność: własna grafika gracza → motyw → domyślna z serwera → zdjęcie konsoli.

export const ThemePkg = createContext<ThemePackage | undefined>(undefined)

/** klucze kategorii pozycji karuzeli, od najdokładniejszego; podgrupa biblioteki bez własnej sceny — scena grupy
 *  (np. „pc/all” → „grp:pc”). Platforma — tylko własny klucz (jej zdjęcie konsoli zostaje, gdy motyw jej nie ma). */
export function categoryKeys(sys: TvSystem): string[] {
  if (sys.es) return [`es:${sys.es}`]
  const id = groupArtId(sys)
  if (!id) return []
  const own = id.replace(/^navgrp:/, '')
  return sys.sub && sys.group ? [own, `grp:${sys.group.id}`] : [own]
}

/** plik z motywu dla pozycji karuzeli (tło albo logo) — adres lumen-theme:// albo undefined */
export function categoryArt(pkg: ThemePackage | undefined, sys: TvSystem, kind: 'hero' | 'logo'): string | undefined {
  if (!pkg) return undefined
  // logo — tylko dokładny klucz (scena grupy pod podgrupą tak, ale jej logo zakryłoby nazwę podgrupy)
  const keys = kind === 'logo' ? categoryKeys(sys).slice(0, 1) : categoryKeys(sys)
  for (const k of keys) {
    const rel = pkg.categories[kind === 'logo' ? `${k}@logo` : k]
    if (rel) return layerSrc(pkg, rel)
  }
  return undefined
}

export const useThemePkg = (): ThemePackage | undefined => useContext(ThemePkg)
