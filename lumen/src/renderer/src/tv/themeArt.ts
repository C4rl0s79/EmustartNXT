import { createContext, useContext } from 'react'
import type { ThemePackage } from '@shared/types'
import { layerSrc } from '../lib/themeLayers'
import { groupArtId } from './GroupArt'
import type { TvSystem } from './data'

// Domyślne grafiki kategorii z motywu z paczki (theme.json → categories, etap 14d). Klucz: grupa / podgrupa
// biblioteki jak w „Grafice grupy” (np. „pc”, „pc/steam”, „grp:konsole”) albo platforma EmuStart „es:<system>”;
// „@logo” na końcu — logo zamiast tła. Kolejność: własna grafika gracza → motyw → domyślna z serwera → zdjęcie konsoli.

export const ThemePkg = createContext<ThemePackage | undefined>(undefined)

/** klucze kategorii pozycji karuzeli, od najdokładniejszego */
export function categoryKeys(sys: TvSystem): string[] {
  if (sys.es) return [`es:${sys.es}`]
  const id = groupArtId(sys)
  return id ? [id.replace(/^navgrp:/, '')] : []
}

/** plik z motywu dla pozycji karuzeli (tło albo logo) — adres lumen-theme:// albo undefined */
export function categoryArt(pkg: ThemePackage | undefined, sys: TvSystem, kind: 'hero' | 'logo'): string | undefined {
  if (!pkg) return undefined
  for (const k of categoryKeys(sys)) {
    const rel = pkg.categories[kind === 'logo' ? `${k}@logo` : k]
    if (rel) return layerSrc(pkg, rel)
  }
  return undefined
}

export const useThemePkg = (): ThemePackage | undefined => useContext(ThemePkg)
