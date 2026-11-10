import { useMemo } from 'react'
import { buildNav, findSub, pinnedSubs, type NavGroup, type NavSub } from '@shared/libraryNav'
import { api, attempt, useStore } from '../store'

// The library hierarchy for both layouts (desktop tabs + chips, TV carousels) — one model, built from the
// same snapshot and prefs (src/shared/libraryNav.ts).

// One hierarchy for all components (App, top bar, screens): built once per snapshot / prefs change,
// not once per component that asks for it.
let shared: { games: unknown; prefs: unknown; collections: unknown; nav: NavGroup[] } | undefined

export function useNav(): NavGroup[] {
  const games = useStore((s) => s.snapshot?.games)
  const collections = useStore((s) => s.snapshot?.collections ?? null)
  const prefs = useStore((s) => s.prefs)
  return useMemo(() => {
    if (!games || !prefs) return []
    if (shared && shared.games === games && shared.prefs === prefs && shared.collections === collections) return shared.nav
    const nav = buildNav(games, prefs, collections)
    shared = { games, prefs, collections, nav }
    return nav
  }, [games, prefs, collections])
}

export function usePinned(nav: NavGroup[]): { group: NavGroup; sub: NavSub }[] {
  const pins = useStore((s) => s.prefs?.pinnedGroups)
  return useMemo(() => pinnedSubs(nav, pins ?? []), [nav, pins])
}

export { findSub }

/** pins exist for platform subgroups and collections (Ulubione / Ostatnio grane are fixed groups already) */
export const pinnable = (sub: NavSub): boolean => !sub.id.startsWith('fav/') && !sub.id.startsWith('recent/')

/** Label of a pinned subgroup: "PC" for pc/all, the platform / collection name otherwise. */
export function pinLabel(group: NavGroup, sub: NavSub): string {
  return sub.id.endsWith('/all') ? group.label : sub.label
}

const lastKey = (groupId: string): string => `lumen.nav.${groupId}`

/** The subgroup last chosen in a group (desktop and TV share it) — "Wszystkie" the first time. */
export function lastSub(group: NavGroup): NavSub {
  try {
    const id = localStorage.getItem(lastKey(group.id))
    const hit = group.subs.find((s) => s.id === id)
    if (hit) return hit
  } catch {
    /* storage unavailable */
  }
  return group.subs[0]
}

export function rememberSub(groupId: string, subId: string): void {
  try {
    localStorage.setItem(lastKey(groupId), subId)
  } catch {
    /* storage unavailable */
  }
}

export async function togglePin(subId: string, pinned: boolean): Promise<void> {
  const p = await attempt(api().prefs.setGroupPinned(subId, pinned))
  if (p) {
    useStore.getState().setPrefs(p)
    useStore.getState().toast(pinned ? 'Przypięto do szybkiego dostępu.' : 'Odpięto.', 'info')
  }
}
