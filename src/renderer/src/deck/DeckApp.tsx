import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DECK_DEFAULT_COLS, activeGroup, clampCols, deckCandidates, onThisPc, syncGroups, visibleGroups, type DeckGeometry } from '@shared/deck'
import { api, useStore } from '../store'
import { findSub, useNav } from '../lib/nav'
import { subItem } from '../tv/data'
import { DeckTab } from './DeckTab'
import { DeckPanel, tileMetrics } from './DeckPanel'

// The dock: one tab per Deck group (a library subgroup of Lumen), with the platform's logo (DeckTab); the
// mouse over it opens the games panel below (DeckPanel), leaving both closes it after a moment (auto hide).
// New subgroups are added to the stored tabs by the main process (index.ts, scheduleDeckSync) — this page
// only shows them. One window holds the dock and the panel; the main process sizes and places it
// (deckGeometry), this page draws them where it says.

/** the panel closes this long after the mouse left the dock and the panel (deck_app._hide_timer) */
const HIDE_MS = 450

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
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [geo, setGeo] = useState<DeckGeometry | null>(null)
  const [open, setOpen] = useState(false)
  /** columns changed with Ctrl + wheel, shown before the stored value comes back */
  const [localCols, setLocalCols] = useState<{ id: string; cols: number } | null>(null)

  useEffect(() => {
    const s = useStore.getState()
    const a = api()
    void a.library.get().then(s.setSnapshot)
    void a.prefs.get().then(s.setPrefs)
    void a.settings.get().then(s.setSettings)
    void a.deck.getGeometry().then((g) => g && setGeo(g))
    const offs = [
      a.library.onSnapshot(s.setSnapshot),
      a.prefs.onChange(s.setPrefs),
      a.settings.onChange(s.setSettings),
      a.art.onChanged(s.bumpArt),
      a.deck.onGeometry(setGeo)
    ]
    return () => {
      offs.forEach((off) => off())
      clearTimeout(saveTimer.current)
      clearTimeout(hideTimer.current)
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
  // each tab as the TV carousel describes its subgroup: logo of the platform (server), Steam, own group logo
  // (keyed on the shown ids: a settings change such as the active tab does not rebuild them)
  const systems = useStore((s) => s.snapshot?.emustart.systems)
  const shownIds = JSON.stringify(visible.map((g) => g.id))
  const tabs = useMemo(() => {
    const labels = new Map(candidates.map((c) => [c.id, c.label]))
    return (JSON.parse(shownIds) as string[]).map((id) => {
      const f = findSub(nav, id)
      return { id, label: labels.get(id) ?? id, sys: f ? subItem(f.group, f.sub, systems ?? []) : undefined }
    })
  }, [shownIds, nav, systems, candidates])

  const choose = (id: string, delay = 0): void => {
    setLocalActive(id)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      if (id !== useStore.getState().settings?.deck.activeGroup) void api().settings.patch({ deck: { activeGroup: id } })
    }, delay)
  }

  // the active tab's games and their tiles; the panel asks the main process for the height they need
  const group = active
  const games = useMemo(() => (group ? (findSub(nav, group.id)?.sub.games ?? []).filter(onThisPc) : []), [nav, group])
  const cols = group ? (localCols?.id === group.id ? localCols.cols : group.cols) : DECK_DEFAULT_COLS
  // the local columns give way only to the stored value that matches them (an older save arriving later
  // must not undo a newer notch) — or to another tab
  const storedCols = group?.cols
  useEffect(() => {
    setLocalCols((l) => (l && (l.id !== group?.id || l.cols === storedCols) ? null : l))
  }, [storedCols, group?.id])
  const content = geo && group && deck ? tileMetrics(geo.panel.width, cols, group.aspect, deck.showLabels, games.length).content : null
  useEffect(() => {
    api().deck.expand(open && content !== null ? content : null)
  }, [open, content])

  const show = (): void => {
    clearTimeout(hideTimer.current)
    setOpen(true)
  }
  const hideSoon = (): void => {
    clearTimeout(hideTimer.current)
    if (deck?.autoHide === false) return
    hideTimer.current = setTimeout(() => setOpen(false), HIDE_MS)
  }
  const changeCols = useCallback(
    (n: number) => {
      if (!group) return
      const c = clampCols(n)
      setLocalCols({ id: group.id, cols: c })
      void api().deck.group({ id: group.id, cols: c })
    },
    [group]
  )

  const onWheel = (e: React.WheelEvent): void => {
    // deltaY 0: a sideways touchpad swipe or shift+wheel — not a tab change
    if (!visible.length || !e.deltaY || e.timeStamp - lastStep.current < WHEEL_STEP_MS) return
    lastStep.current = e.timeStamp
    const i = Math.max(0, visible.findIndex((g) => g.id === active?.id))
    choose(visible[(i + (e.deltaY > 0 ? 1 : visible.length - 1)) % visible.length].id, SAVE_MS)
  }

  const dock = geo?.dock
  return (
    <div className="deck-root" onMouseEnter={() => open && clearTimeout(hideTimer.current)} onMouseLeave={hideSoon}>
      <div
        className="deck-dock"
        style={dock ? { left: dock.x, top: dock.y, width: dock.width, height: dock.height } : undefined}
        onMouseEnter={show}
        onWheel={onWheel}
        onContextMenu={(e) => {
          e.preventDefault()
          api().deck.menu()
        }}
      >
        {tabs.length && deck ? (
          tabs.map((t) => (
            <DeckTab
              key={t.id}
              sys={t.sys}
              label={t.label}
              active={t.id === active?.id}
              showLogos={deck.showLogos}
              // the open tab clicked again closes the panel (the only way when auto hide is off)
              onClick={() => (t.id === active?.id && open ? setOpen(false) : (choose(t.id), show()))}
            />
          ))
        ) : (
          <div className="deck-empty">{loaded ? 'Brak zakładek — wszystkie ukryte albo bez gier (prawy klik: menu)' : 'Biblioteka się wczytuje…'}</div>
        )}
      </div>
      {geo?.expanded && group && deck && (
        <div style={{ position: 'absolute', left: geo.panel.x, top: geo.panel.y }}>
          <DeckPanel games={games} cols={cols} aspect={group.aspect} showLabels={deck.showLabels} width={geo.panel.width} height={geo.panel.height} onCols={changeCols} />
        </div>
      )}
    </div>
  )
}
