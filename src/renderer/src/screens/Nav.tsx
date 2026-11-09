import { useEffect, useMemo, useState } from 'react'
import type { NavGroup, NavSub } from '@shared/libraryNav'
import { useStore } from '../store'
import { lastSub, pinLabel, pinnable, rememberSub, togglePin } from '../lib/nav'
import { GroupScreen, type GroupView } from './Group'

// Desktop: a top-bar tab of the library hierarchy. A group tab (PC, Konsole…) shows its subgroups as chips
// and opens on the subgroup chosen last ("Wszystkie" the first time); a pinned tab shows one subgroup.

const EMPTY_HINT: Record<string, string> = {
  fav: 'Naciśnij R3 (lub U) na plakacie, aby dodać grę do ulubionych.',
  col: 'Przypisz gry w ekranie gry → „Kategorie”.'
}

function viewOf(group: NavGroup, sub: NavSub, pinned: string[], chips: boolean): GroupView {
  const isPinned = pinned.includes(sub.id)
  return {
    key: `nav:${sub.id}`,
    title: chips || sub.id.endsWith('/all') ? group.label : pinLabel(group, sub),
    games: sub.games,
    badge: group.id === 'col' ? undefined : sub.id === 'pc/gog' ? 'serwer EmuStart' : sub.es ? 'EmuStart' : undefined,
    notice: sub.id === 'pc/steam' ? 'steam' : sub.es ? 'emu' : undefined,
    emptyHint: EMPTY_HINT[group.id],
    ...(chips && group.subs.length > 1
      ? { chips: group.subs.map((s) => ({ id: s.id, label: s.label, count: s.games.length })), chip: sub.id }
      : {}),
    ...(pinnable(sub) ? { pin: { pinned: isPinned, toggle: () => void togglePin(sub.id, !isPinned) } } : {})
  }
}

export function NavGroupScreen({ group, active }: { group: NavGroup; active: boolean }) {
  const pins = useStore((s) => s.prefs?.pinnedGroups ?? [])
  const [subId, setSubId] = useState(() => lastSub(group).id)
  // the chosen subgroup vanished (last game of a platform removed): back to "Wszystkie"
  const sub = useMemo(() => group.subs.find((s) => s.id === subId) ?? group.subs[0], [group, subId])
  useEffect(() => {
    if (sub.id !== subId) setSubId(sub.id)
  }, [sub.id, subId])
  const view = viewOf(group, sub, pins, true)
  view.onChip = (id) => {
    setSubId(id)
    rememberSub(group.id, id)
  }
  return <GroupScreen view={view} active={active} />
}

export function NavPinnedScreen({ group, sub, active }: { group: NavGroup; sub: NavSub; active: boolean }) {
  const pins = useStore((s) => s.prefs?.pinnedGroups ?? [])
  return <GroupScreen view={viewOf(group, sub, pins, false)} active={active} />
}
