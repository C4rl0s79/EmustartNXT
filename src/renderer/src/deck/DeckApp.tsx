import { useEffect, useMemo, useRef, useState } from 'react'
import { activeGroup, deckCandidates, syncGroups, visibleGroups } from '@shared/deck'
import { api, useStore } from '../store'
import { useNav } from '../lib/nav'

// The dock: one tab per Deck group (a library subgroup of Lumen). Etap 2 — the window, its data and
// its menu; platform logos come in etap 3, the panel with tiles in etap 4. New subgroups are added to
// the stored tabs by the main process (index.ts, scheduleDeckSync) — this page only shows them.

/** one wheel notch → one tab; a touchpad's burst of wheel events is not a dozen notches */
const WHEEL_STEP_MS = 120
/** the active tab is saved once the wheel stops (deck_app._save_soon) */
const SAVE_MS = 600

export function DeckApp() {
  const settings = useStore((s) => s.settings)
  const loaded = useStore((s) => !!s.snapshot && !!s.prefs && !!s.settings)
  const nav = useNav()
  const deck = settings?.deck
  const [localActive, setLocalActive] = useState<string | null>(null)
  const lastStep = useRef(0)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    const s = useStore.getState()
    const a = api()
    void a.library.get().then(s.setSnapshot)
    void a.prefs.get().then(s.setPrefs)
    void a.settings.get().then(s.setSettings)
    const offs = [a.library.onSnapshot(s.setSnapshot), a.prefs.onChange(s.setPrefs), a.settings.onChange(s.setSettings)]
    return () => {
      offs.forEach((off) => off())
      clearTimeout(saveTimer.current)
    }
  }, [])

  // the stored choice arrived (ours saved, or changed elsewhere): it wins over the local one
  const storedActive = deck?.activeGroup
  useEffect(() => setLocalActive(null), [storedActive])

  const candidates = useMemo(() => deckCandidates(nav), [nav])
  // shown at once, before the main process has stored the new tabs
  const groups = useMemo(() => (deck ? syncGroups(deck.groups, candidates) : []), [deck, candidates])
  const visible = useMemo(() => (deck ? visibleGroups({ ...deck, groups }, candidates) : []), [deck, groups, candidates])
  const active = deck ? activeGroup({ ...deck, activeGroup: localActive ?? deck.activeGroup }, visible) : undefined
  const labels = useMemo(() => new Map(candidates.map((c) => [c.id, c.label])), [candidates])

  const choose = (id: string, delay = 0): void => {
    setLocalActive(id)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      if (id !== useStore.getState().settings?.deck.activeGroup) void api().settings.patch({ deck: { activeGroup: id } })
    }, delay)
  }

  const onWheel = (e: React.WheelEvent): void => {
    if (!visible.length || e.timeStamp - lastStep.current < WHEEL_STEP_MS) return
    lastStep.current = e.timeStamp
    const i = Math.max(0, visible.findIndex((g) => g.id === active?.id))
    choose(visible[(i + (e.deltaY > 0 ? 1 : visible.length - 1)) % visible.length].id, SAVE_MS)
  }

  return (
    <div
      className="deck-dock"
      onWheel={onWheel}
      onContextMenu={(e) => {
        e.preventDefault()
        api().deck.menu()
      }}
    >
      {visible.length ? (
        visible.map((g) => (
          <div key={g.id} className={'deck-tab' + (g.id === active?.id ? ' active' : '')} onClick={() => choose(g.id)} title={labels.get(g.id)}>
            {labels.get(g.id) ?? g.id}
          </div>
        ))
      ) : (
        <div className="deck-empty">{loaded ? 'Brak zakładek — wszystkie ukryte albo bez gier (prawy klik: menu)' : 'Biblioteka się wczytuje…'}</div>
      )}
    </div>
  )
}
