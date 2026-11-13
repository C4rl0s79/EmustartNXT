import type { NavGroup } from './libraryNav'
import type { Game } from './types'

// Deck — optional desktop interface of Lumen (dock of platform tabs over the wallpaper, below app windows;
// hovering opens a panel of tiles). Its settings model, ported from PyLinksDeck/deck/profiles.py:
// - tabs are library subgroups of Lumen's navigation (buildNav ids: 'console/emu:ps2', 'pc/steam',
//   'col/<category id>') — Deck has no library or collections of its own;
// - a tile size is a NUMBER OF COLUMNS, not pixels (200 px is 18 % of a 1080p screen and 8 % of 1440p);
// - only the dock and panel dimensions depend on the screen, stored as fractions of the primary
//   screen's work area, one entry per screen (size + scale — never the monitor name).

export const DECK_MIN_COLS = 1
export const DECK_MAX_COLS = 24
export const DECK_DEFAULT_COLS = 8
/** gap between tiles in logical px (PyLinksDeck: constant, tiles stretch to fill the row) */
export const DECK_TILE_GAP = 8
const MAX_GROUPS = 300
const MAX_SCREENS = 50

export type DeckAspect = 'portrait' | 'square'

/** One dock tab. Order in DeckSettings.groups = tab order. */
export interface DeckGroup {
  /** NavSub id of Lumen's library navigation */
  id: string
  /** tiles per row */
  cols: number
  /** portrait = 2:3 cover, square = square tile */
  aspect: DeckAspect
  /** hidden by the player (a tab without games is not shown either, but keeps its setting) */
  hidden: boolean
}

/** Dock and panel dimensions on one screen — the only thing allowed to differ between screens. */
export interface DeckScreenLayout {
  label: string
  /** fraction of the work area's width */
  dockWidth: number
  /** logical px (scale with DPI) */
  dockHeight: number
  dockOffset: number
  panelWidth: number
  /** fraction of the work area's height: the panel's maximum (it is only as tall as its tiles need) */
  panelHeight: number
}

export interface DeckSettings {
  /** Deck on/off — off: no Deck window exists, Lumen works exactly as without it */
  enabled: boolean
  groups: DeckGroup[]
  activeGroup: string
  showLabels: boolean
  showLogos: boolean
  scrollSpeed: number
  animations: boolean
  autoHide: boolean
  opacity: number
  /** screen key (screenKey) → dimensions */
  screens: Record<string, DeckScreenLayout>
}

export const defaultDeckLayout = (label = ''): DeckScreenLayout => ({
  label,
  dockWidth: 0.95,
  dockHeight: 46,
  dockOffset: 0,
  panelWidth: 0.94,
  panelHeight: 0.8
})

export const defaultDeckSettings = (): DeckSettings => ({
  enabled: false,
  groups: [],
  activeGroup: '',
  showLabels: true,
  showLogos: true,
  scrollSpeed: 0.7,
  animations: true,
  autoHide: true,
  opacity: 0.96,
  screens: {}
})

export function clampCols(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : DECK_DEFAULT_COLS
  return Math.max(DECK_MIN_COLS, Math.min(DECK_MAX_COLS, n))
}

/** Python's `{x:g}` for a scale factor: 1 → "1", 1.25 → "1.25" (rounded to 2 decimals like profiles.py). */
const fmtScale = (s: number): string => String(Math.round(s * 100) / 100)

/**
 * Key and readable label of ONE screen. The key is its size in logical px (after Windows display scaling)
 * and the scale, never the monitor's name (Windows renames monitors when screens are switched; PyLinksDeck
 * 0.6.2 learned that): "2560x1440@1.5". The label shows what the player knows — the screen's resolution
 * and the scaling: "3840×2160, skalowanie 150%" (`physical`: the size in device pixels, from Windows).
 */
export function screenKey(w: number, h: number, scale: number, physical: { width: number; height: number }): { key: string; label: string } {
  // whole logical pixels, or the key would never pass validation on load (2560 / 1.5 = 1706.67)
  const width = Math.round(w)
  const height = Math.round(h)
  const s = Math.round(scale * 100) / 100
  return {
    key: `${width}x${height}@${fmtScale(s)}`,
    label:
      `${Math.round(physical.width)}×${Math.round(physical.height)}` +
      (Math.abs(s - 1) > 0.01 ? `, skalowanie ${Math.round(s * 100)}%` : '')
  }
}

/** Dimensions for a screen: the stored ones or defaults (does not change the settings). */
export function layoutFor(s: DeckSettings, key: string, label = ''): DeckScreenLayout {
  return s.screens[key] ?? defaultDeckLayout(label)
}

export interface DeckRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The dock on the primary screen's work area (deck_app._layout_windows): centred, at the top, the
 * layout's fraction of the width (at least 240 px), its height (at least 28 px), moved down by the offset.
 * Always inside the work area: a layout stored for a taller screen must not put the dock off-screen,
 * where its menu (the way back to a hidden Lumen) cannot be reached.
 */
export function dockRect(area: DeckRect, lay: DeckScreenLayout): DeckRect {
  const width = Math.min(area.width, Math.max(240, Math.floor(area.width * lay.dockWidth)))
  const height = Math.min(area.height, Math.max(28, Math.floor(lay.dockHeight)))
  const offset = Math.min(Math.max(0, lay.dockOffset), area.height - height)
  return { x: area.x + Math.floor((area.width - width) / 2), y: area.y + offset, width, height }
}

/** gap between the dock and the panel, and the panel's margin from the bottom of the work area (px) */
const PANEL_GAP = 8
const PANEL_MIN_W = 320
const PANEL_MIN_H = 160
/** less room than this under the dock (a dock moved to the bottom, a short screen): the panel does not open */
const PANEL_MIN_ROOM = 60

/**
 * Where the dock and the games panel are. One window holds both: collapsed it is just the dock; expanded it
 * spans the dock and the panel below it (deck_app._panel_rect): the panel is the layout's fraction of the
 * width (at least 320 px), centred, 8 px under the dock, as tall as its tiles need (`content`) but at most
 * the layout's fraction of the height and never past the work area (at least 160 px when it fits; with no
 * room under the dock it does not open). The window's left edge and width are the same open and closed —
 * only its height changes — so the dock never moves inside it while the window is resized. Positions of the
 * dock and the panel are relative to the window; `panel` is known also closed (its width sizes the tiles).
 */
export interface DeckGeometry {
  window: DeckRect
  dock: DeckRect
  panel: DeckRect
  expanded: boolean
}

export function deckGeometry(area: DeckRect, lay: DeckScreenLayout, content: number | null): DeckGeometry {
  const dock = dockRect(area, lay)
  const width = Math.min(area.width, Math.max(PANEL_MIN_W, Math.floor(area.width * lay.panelWidth)))
  const top = dock.y + dock.height + PANEL_GAP
  const maxHeight = Math.max(0, Math.min(Math.floor(area.height * lay.panelHeight), area.y + area.height - top - PANEL_GAP))
  const panelX = area.x + Math.floor((area.width - width) / 2)
  const x = Math.min(dock.x, panelX)
  const span = Math.max(dock.x + dock.width, panelX + width) - x
  const open = content !== null && maxHeight >= PANEL_MIN_ROOM
  const height = open ? Math.min(maxHeight, Math.max(PANEL_MIN_H, Math.ceil(content))) : 0
  return {
    window: { x, y: dock.y, width: span, height: open ? top + height - dock.y : dock.height },
    dock: { ...dock, x: dock.x - x, y: 0 },
    panel: { x: panelX - x, y: top - dock.y, width, height },
    expanded: open
  }
}

// ---------- tabs ----------

/**
 * A game Deck shows: one on this PC — installed (Steam, GOG, a Steam shortcut with its program) or downloaded
 * (EmuStart's game cache). PyLinksDeck showed the games there were shortcuts for, i.e. those on the PC; the
 * same rule as the TV list's "ready" count (tv/data.ts readyCount).
 */
export const onThisPc = (g: Game): boolean => (g.emu ? !!g.emu.cached : g.installed)

/** A library subgroup that can be a Deck tab, with its number of games on this PC. */
export interface DeckCandidate {
  id: string
  label: string
  kind: 'platform' | 'collection'
  count: number
  /** EmuStart platform (logo) */
  es?: string
}

/**
 * Subgroups of the library that can be tabs: every platform subgroup (PC: Steam / GOG / Skróty Steam,
 * every emulated platform, unknown platforms) and every collection. "Wszystkie", Ulubione and Ostatnio
 * grane are left out — PyLinksDeck had platforms and collections only.
 */
export function deckCandidates(nav: NavGroup[]): DeckCandidate[] {
  const out: DeckCandidate[] = []
  for (const g of nav) {
    if (g.id === 'fav' || g.id === 'recent') continue
    for (const sub of g.subs) {
      if (g.id !== 'col' && sub.id === `${g.id}/all`) continue // the synthetic "Wszystkie", not a collection with id 'all'
      out.push({ id: sub.id, label: sub.label, kind: g.id === 'col' ? 'collection' : 'platform', count: sub.games.filter(onThisPc).length, ...(sub.es ? { es: sub.es } : {}) })
    }
  }
  return out
}

const newGroup = (id: string): DeckGroup => ({ id, cols: DECK_DEFAULT_COLS, aspect: 'portrait', hidden: false })

/**
 * Tabs matched to the library without touching the player's settings (deck_app._sync_groups): subgroups
 * not known yet are appended — collections first, then platforms, each by number of games (most first),
 * then name. Existing tabs keep their order, visibility and look, also when their subgroup is gone now.
 * Unlike PyLinksDeck, an empty tab is not marked hidden for good (visibleGroups leaves it out instead),
 * so it comes back when its games do.
 */
export function syncGroups(groups: DeckGroup[], candidates: DeckCandidate[]): DeckGroup[] {
  const known = new Set(groups.map((g) => g.id))
  // only what cleanDeckSettings keeps — anything else would come back as "new" on every sync
  const fresh = candidates
    .filter((c) => !known.has(c.id) && c.count > 0 && NAV_ID.test(c.id))
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'collection' ? -1 : 1) || b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, Math.max(0, MAX_GROUPS - groups.length))
  return fresh.length ? [...groups, ...fresh.map((c) => newGroup(c.id))] : groups
}

/** the range of the dock / games panel width the player can set (fraction of the screen's width) */
export const DECK_WIDTH_MIN = 0.3
export const DECK_WIDTH_MAX = 1

/**
 * One step of a width the player sets in Settings → Deck, for one screen. A step, not a value: presses
 * quicker than the settings round trip add up instead of resending the same stale value.
 */
export interface DeckLayoutStep {
  key: string
  label: string
  field: 'dockWidth' | 'panelWidth'
  /** change in fractions of the screen's width (+0.01 = one per cent more) */
  delta: number
}

/**
 * The screens map after one step on one screen (stored or default dimensions as the base). The edited
 * screen moves to the end — the newest entries are the ones kept (cleanDeckSettings).
 */
export function setDeckLayout(s: DeckSettings, step: DeckLayoutStep): Record<string, DeckScreenLayout> {
  const cur = layoutFor(s, step.key, step.label)
  const v = Math.round(Math.max(DECK_WIDTH_MIN, Math.min(DECK_WIDTH_MAX, cur[step.field] + step.delta)) * 100) / 100
  const rest = { ...s.screens }
  delete rest[step.key]
  return { ...rest, [step.key]: { ...cur, [step.field]: v, label: step.label } }
}

/** the panel's largest height the player can drag it to (fraction of the work area's height) — as cleanLayout keeps */
export const DECK_PANEL_H_MIN = 0.1
export const DECK_PANEL_H_MAX = 1

/** the panel closes this long after the mouse left the dock and the panel (deck_app._hide_timer) */
export const DECK_HIDE_MS = 450

/** A dragged panel height in px → the stored fraction of the work area's height (2 decimals, within range). */
export function panelHeightFraction(px: number, areaHeight: number): number {
  const f = areaHeight > 0 && Number.isFinite(px) ? px / areaHeight : DECK_PANEL_H_MAX
  return Math.round(Math.max(DECK_PANEL_H_MIN, Math.min(DECK_PANEL_H_MAX, f)) * 1000) / 1000
}

/** The screens map with the panel's largest height set on one screen (the edited screen moves to the end). */
export function setDeckPanelHeight(s: DeckSettings, key: string, label: string, fraction: number): Record<string, DeckScreenLayout> {
  const cur = layoutFor(s, key, label)
  const rest = { ...s.screens }
  delete rest[key]
  return { ...rest, [key]: { ...cur, panelHeight: Math.max(DECK_PANEL_H_MIN, Math.min(DECK_PANEL_H_MAX, fraction)), label } }
}

/** One change of the tab list (Settings: show / hide / order; the panel: columns) — applied by the main process. */
export type DeckGroupOp = { id: string; hidden: boolean } | { id: string; move: -1 | 1 } | { id: string; cols: number } | { id: string; aspect: DeckAspect }

/** The tabs after one change; the same array when nothing changes (unknown tab, edge of the list). */
export function moveDeckGroup(groups: DeckGroup[], op: DeckGroupOp): DeckGroup[] {
  const i = groups.findIndex((g) => g.id === op.id)
  if (i < 0) return groups
  if ('hidden' in op) return groups[i].hidden === op.hidden ? groups : groups.map((g, k) => (k === i ? { ...g, hidden: op.hidden } : g))
  if ('cols' in op) {
    const cols = clampCols(op.cols)
    return groups[i].cols === cols ? groups : groups.map((g, k) => (k === i ? { ...g, cols } : g))
  }
  if ('aspect' in op) {
    const aspect: DeckAspect = op.aspect === 'square' ? 'square' : 'portrait'
    return groups[i].aspect === aspect ? groups : groups.map((g, k) => (k === i ? { ...g, aspect } : g))
  }
  const j = i + op.move
  if (j < 0 || j >= groups.length) return groups
  const next = [...groups]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

/** Tabs shown on the dock: not hidden by the player and with at least one game now. */
export function visibleGroups(s: DeckSettings, candidates: DeckCandidate[]): DeckGroup[] {
  const counts = new Map(candidates.map((c) => [c.id, c.count]))
  return s.groups.filter((g) => !g.hidden && (counts.get(g.id) ?? 0) > 0)
}

/** The active tab: the stored one when shown, otherwise the first shown tab. */
export function activeGroup(s: DeckSettings, visible: DeckGroup[]): DeckGroup | undefined {
  return visible.find((g) => g.id === s.activeGroup) ?? visible[0]
}

// ---------- persistence ----------

const num = (v: unknown, min: number, max: number, dflt: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : dflt

// a Steam collection id can carry a tag name with spaces and non-Latin letters ('from-tag-Gry PS2')
const NAV_ID = /^[a-z]+\/[^\x00-\x1f]{1,200}$/
const SCREEN_KEY = /^\d{2,5}x\d{2,5}@\d+(\.\d+)?$/

function cleanLayout(v: unknown): DeckScreenLayout {
  const d = defaultDeckLayout()
  const r = (v && typeof v === 'object' ? v : {}) as Partial<DeckScreenLayout>
  return {
    label: typeof r.label === 'string' ? r.label.slice(0, 40) : '',
    dockWidth: num(r.dockWidth, DECK_WIDTH_MIN, DECK_WIDTH_MAX, d.dockWidth),
    dockHeight: Math.round(num(r.dockHeight, 24, 160, d.dockHeight)),
    dockOffset: Math.round(num(r.dockOffset, -4000, 4000, d.dockOffset)),
    panelWidth: num(r.panelWidth, DECK_WIDTH_MIN, DECK_WIDTH_MAX, d.panelWidth),
    panelHeight: num(r.panelHeight, 0.1, 1, d.panelHeight)
  }
}

/**
 * A Deck patch changes only the fields it names — a patch from one window ({ enabled }) or from the Deck
 * window ({ screens }) must not wipe the tabs or the other screens' dimensions.
 */
export function mergeDeck(cur: DeckSettings, p: Partial<DeckSettings> | undefined): DeckSettings {
  return p ? cleanDeckSettings({ ...cur, ...p }) : cur
}

/** Stored Deck settings → valid ones (anything unknown or out of range falls back to the default). */
export function cleanDeckSettings(raw: unknown): DeckSettings {
  const d = defaultDeckSettings()
  if (!raw || typeof raw !== 'object') return d
  const r = raw as Partial<Record<keyof DeckSettings, unknown>>
  const seen = new Set<string>()
  const groups: DeckGroup[] = []
  for (const g of Array.isArray(r.groups) ? r.groups : []) {
    if (groups.length >= MAX_GROUPS) break
    const x = (g && typeof g === 'object' ? g : {}) as Partial<DeckGroup>
    if (typeof x.id !== 'string' || !NAV_ID.test(x.id) || seen.has(x.id)) continue
    seen.add(x.id)
    groups.push({ id: x.id, cols: clampCols(x.cols), aspect: x.aspect === 'square' ? 'square' : 'portrait', hidden: x.hidden === true })
  }
  const screens: Record<string, DeckScreenLayout> = {}
  if (r.screens && typeof r.screens === 'object')
    // the newest entries are kept (a new screen is added last) — a long-used laptop must not lock out a new monitor
    for (const [k, v] of Object.entries(r.screens as Record<string, unknown>).filter(([k]) => SCREEN_KEY.test(k)).slice(-MAX_SCREENS))
      screens[k] = cleanLayout(v)
  return {
    enabled: r.enabled === true,
    groups,
    // a tab not stored yet may already be chosen (shown before the main process stores it); activeGroup()
    // falls back to the first shown tab for an id that is not shown
    activeGroup: typeof r.activeGroup === 'string' && NAV_ID.test(r.activeGroup) ? r.activeGroup : '',
    showLabels: r.showLabels !== false,
    showLogos: r.showLogos !== false,
    scrollSpeed: num(r.scrollSpeed, 0.1, 3, d.scrollSpeed),
    animations: r.animations !== false,
    autoHide: r.autoHide !== false,
    opacity: num(r.opacity, 0.3, 1, d.opacity),
    screens
  }
}
