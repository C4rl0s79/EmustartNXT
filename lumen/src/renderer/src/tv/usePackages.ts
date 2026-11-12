import { useEffect, useSyncExternalStore } from 'react'
import type { ThemePackage, TvAnim } from '@shared/types'
import { api, useStore } from '../store'

// Motywy z paczek z serwera (main/themes.ts): lista wczytana raz, odświeżana zdarzeniem po synchronizacji.

let list: ThemePackage[] = []
let loaded = false
const subs = new Set<() => void>()
const set = (l: ThemePackage[]): void => {
  list = l
  subs.forEach((f) => f())
}

export function useThemePackages(): ThemePackage[] {
  useEffect(() => {
    if (loaded) return
    loaded = true
    void api().themes.list().then(set, () => undefined)
    api().themes.onChange(set)
  }, [])
  return useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => list
  )
}

/** poziom animacji w użyciu: ustawienie gracza, a przy ograniczonym ruchu w Windows — wył. */
export function useTvAnim(): TvAnim {
  const level = useStore((s) => s.settings?.tvAnim ?? 'med')
  const reduced = useSyncExternalStore(
    (f) => {
      const m = window.matchMedia('(prefers-reduced-motion: reduce)')
      m.addEventListener('change', f)
      return () => m.removeEventListener('change', f)
    },
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
  return reduced ? 'off' : level
}
