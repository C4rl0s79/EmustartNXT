import type { PlatformInfo } from './types'
import { platformForTag } from './libraryNav'
import { clampCols, cleanDeckSettings, type DeckCandidate, type DeckGroup, type DeckScreenLayout, type DeckSettings } from './deck'

// One-time import of PyLinksDeck's settings (%LOCALAPPDATA%\PyLinksDeck\layouts.json, schema 4): the tabs
// the player kept visible, their order and look, the per-screen dimensions and the options. PyLinksDeck's
// tabs were PyLinksWeb platform folders (PS1, DC, GCN…) and collections; here they become Lumen library
// subgroups — a platform code through EmuStart's catalog (every entry with that code, as PC covers all
// three PC subgroups), a collection by its name. What has no counterpart is reported, never guessed.

/** PyLinksWeb's PC folder held Steam, GOG and other PC shortcuts — all three PC subgroups of Lumen */
const PC_SUBS = ['pc/steam', 'pc/gog', 'pc/shortcut']
/** the only PyLinksDeck format with one tab list for every screen (older ones kept tabs per screen profile) */
const SCHEMA = 4

export interface DeckImport {
  deck: DeckSettings
  /** PyLinksDeck tab → Lumen tabs (a target already taken by an earlier tab is listed too — merged into it) */
  mapped: { from: string; to: { id: string; label: string }[] }[]
  /** PyLinksDeck tabs with no Lumen counterpart */
  skipped: string[]
}

export type DeckImportResult = ({ ok: true } & Omit<DeckImport, 'deck'>) | { ok: false; error: string }

interface PyGroup {
  gid?: string
  title?: string
  rule?: { kind?: string; value?: string }
  cols?: number
  aspect?: string
  hidden?: boolean
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const lower = (s: unknown): string => (typeof s === 'string' ? s.trim().toLowerCase() : '')
// as libraryNav's platform tags: case, spaces, '_' and '-' do not count
const norm = (s: string): string => s.trim().toLowerCase().replace(/[\s_-]+/g, '')

function targets(g: PyGroup, candidates: DeckCandidate[], catalog: PlatformInfo[]): DeckCandidate[] {
  const kind = g.rule?.kind
  const value = String(g.rule?.value ?? '')
  if (kind === 'platform') {
    if (value.toUpperCase() === 'PC') return candidates.filter((c) => PC_SUBS.includes(c.id))
    const t = norm(value)
    // every catalog entry with this id or code (MAME: mame and arcade); else a display-name match
    const exact = catalog.filter((p) => norm(p.es) === t || norm(p.plat) === t)
    const one = exact.length ? exact : [platformForTag(value, catalog)].filter((p): p is PlatformInfo => !!p)
    const es = new Set(one.map((p) => p.es))
    return candidates.filter((c) => !!c.es && es.has(c.es))
  }
  if (kind === 'collection') {
    const names = new Set([lower(value), lower(g.title)].filter(Boolean))
    return candidates.filter((c) => c.kind === 'collection' && names.has(lower(c.label)))
  }
  return []
}

/** PyLinksDeck's settings from its layouts.json, or why the file cannot be imported. */
export function pyDeckSettings(raw: unknown): Record<string, unknown> | { error: string } {
  const r = obj(raw)
  if (r.schema !== SCHEMA) return { error: `To nie są ustawienia PyLinksDeck 0.6 (format ${String(r.schema ?? 'nieznany')}, oczekiwany ${SCHEMA}) — uruchom raz PyLinksDeck 0.6, żeby je przepisał.` }
  const s = obj(r.settings)
  if (!Array.isArray(s.groups) || !s.groups.length) return { error: 'Plik ustawień PyLinksDeck nie ma żadnych zakładek.' }
  return s
}

/**
 * The Deck settings PyLinksDeck's settings (pyDeckSettings) describe, on top of the current ones. Imported
 * tabs come first in PyLinksDeck's order with its visibility, columns and shape; every other tab follows
 * hidden (the player had curated the old Deck), keeping its own look and order — also a tab whose
 * subgroup is gone now. The on/off switch stays as it is.
 */
export function importPyLinksDeck(s: Record<string, unknown>, current: DeckSettings, candidates: DeckCandidate[], catalog: PlatformInfo[]): DeckImport {
  const groups: DeckGroup[] = []
  const taken = new Set<string>()
  const mapped: DeckImport['mapped'] = []
  const skipped: string[] = []
  let active = ''
  for (const g of (Array.isArray(s.groups) ? s.groups : []) as PyGroup[]) {
    const from = String(g.title || g.rule?.value || g.gid || '?')
    const to = targets(g, candidates, catalog)
    if (!to.length) {
      skipped.push(from)
      continue
    }
    for (const c of to) {
      if (taken.has(c.id)) continue
      taken.add(c.id)
      groups.push({ id: c.id, cols: clampCols(g.cols), aspect: g.aspect === 'square' ? 'square' : 'portrait', hidden: g.hidden === true })
    }
    if (g.gid && g.gid === s.active_gid && !active) active = to[0].id
    mapped.push({ from, to: to.map((c) => ({ id: c.id, label: c.label })) })
  }
  // the rest: the player's own tabs (their look and order), then library subgroups not stored yet
  for (const g of current.groups) if (!taken.has(g.id) && (taken.add(g.id), true)) groups.push({ ...g, hidden: true })
  for (const c of candidates) if (!taken.has(c.id)) groups.push({ id: c.id, cols: 8, aspect: 'portrait', hidden: true })

  const screens: Record<string, DeckScreenLayout> = { ...current.screens }
  for (const [key, v] of Object.entries(obj(s.screens))) {
    const l = obj(v)
    screens[key] = {
      label: typeof l.label === 'string' ? l.label : '',
      dockWidth: l.dock_width as number,
      dockHeight: l.dock_height as number,
      dockOffset: l.dock_offset as number,
      panelWidth: l.panel_width as number,
      panelHeight: l.panel_height as number
    }
  }
  const deck = cleanDeckSettings({
    ...current,
    groups,
    activeGroup: active,
    showLabels: s.show_labels ?? current.showLabels,
    showLogos: s.show_logos ?? current.showLogos,
    scrollSpeed: s.scroll_speed ?? current.scrollSpeed,
    animations: s.animations ?? current.animations,
    autoHide: s.auto_hide ?? current.autoHide,
    opacity: s.opacity ?? current.opacity,
    screens
  })
  return { deck, mapped, skipped }
}
