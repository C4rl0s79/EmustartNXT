import type { ArtChoice, ArtKind, Prefs } from '@shared/types'
import type { NavGroup } from '@shared/libraryNav'

// Art choices and the player's own images across devices (engine/emustart/artsync.py, server: userart.py).
// Key: desktop|<game>|<kind> (one art for every view; tv|… keys come only from Lumen ≤ 1.0.75 and count as the same
// art). Newest choice wins; a removed choice travels as null. Local files are uploaded
// first and become `user` choices — a path on this computer never leaves it.

export const KINDS: ArtKind[] = ['grid', 'hero', 'logo', 'icon']

export interface SyncItem {
  key: string
  choice: ArtChoice | null
  at: number
}

export type ServerChoices = Record<string, { choice: ArtChoice | null; at: number }>

const key = (gameId: string, kind: ArtKind): string => `desktop|${gameId}|${kind}`

/** every choice of this device. Choices older than the sync have no stamp: at = 1, older than anything synced */
export function localItems(p: Prefs): SyncItem[] {
  const out: SyncItem[] = []
  const seen = new Set<string>()
  for (const [gameId, a] of Object.entries(p.art))
    for (const kind of KINDS) {
      const c = a[kind]
      if (!c || c.type === 'file') continue // uploaded first, then sent as a `user` choice
      const k = key(gameId, kind)
      seen.add(k)
      out.push({ key: k, choice: c, at: p.artStamps[k] ?? 1 })
    }
  // stamps without a choice: removed here
  for (const [k, at] of Object.entries(p.artStamps)) if (!seen.has(k) && !isFileChoice(p, k)) out.push({ key: k, choice: null, at })
  return out
}

function isFileChoice(p: Prefs, k: string): boolean {
  const [, gameId, kind] = k.split('|')
  return p.art[gameId]?.[kind as ArtKind]?.type === 'file'
}

/** the server's newer choices applied to the prefs; `changed` — games whose art must reload */
export function applyServer(p: Prefs, server: ServerChoices): { prefs: Prefs; changed: string[] } {
  const art = { ...p.art }
  const artStamps = { ...p.artStamps }
  const changed = new Set<string>()
  for (const [serverKey, v] of Object.entries(server)) {
    const [view, gameId, kind] = serverKey.split('|') as [string, string, ArtKind]
    if (!gameId || !KINDS.includes(kind) || (view !== 'desktop' && view !== 'tv')) continue
    // a TV choice from an older Lumen is the same art (newer wins)
    const k = key(gameId, kind)
    if (art[gameId]?.[kind]?.type === 'file') continue // waits for its upload; the local pick is newer
    const local = artStamps[k] ?? (art[gameId]?.[kind] ? 1 : 0)
    if (v.at <= local) continue
    artStamps[k] = v.at
    const cur = { ...(art[gameId] ?? {}) }
    if (v.choice) cur[kind] = v.choice
    else delete cur[kind]
    art[gameId] = cur
    changed.add(gameId)
  }
  return changed.size ? { prefs: { ...p, art, artStamps }, changed: [...changed] } : { prefs: p, changed: [] }
}

/** the server's default art of groups (panel of the server), only what can be shown */
export function parseDefaults(raw: Record<string, { sha?: string; ext?: string }> | undefined): Prefs['artDefaults'] {
  const out: Prefs['artDefaults'] = {}
  for (const [k, v] of Object.entries(raw ?? {})) {
    const [gameId, kind] = k.split('|')
    if (!gameId?.startsWith('navgrp:') || (kind !== 'logo' && kind !== 'hero')) continue
    if (!/^[0-9a-f]{64}$/.test(String(v?.sha)) || !/^(png|jpg|webp|gif)$/.test(String(v?.ext))) continue
    out[gameId] = { ...out[gameId], [kind]: { type: 'user', sha: v.sha!, ext: v.ext! } }
  }
  return out
}

/**
 * names of the collection groups the library shows now (buildNav → 'Kolekcje': Lumen categories and Steam
 * collections with games, id `col/<category id>`), keyed like group art (navgrp:…) — the server panel shows them
 * instead of bare ids. The whole set replaces this account's names on the server, so a removed collection goes away.
 */
export function groupNames(nav: NavGroup[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const s of nav.find((g) => g.id === 'col')?.subs ?? []) if (s.label.trim()) out[`navgrp:${s.id}`] = s.label.trim()
  return out
}

export interface EmuCollection {
  id: string
  name: string
  /** cross-device game ids (savesync.game_id = row.sid) */
  games: string[]
}

/**
 * Lumen's own categories with EmuStart games, for EmuStart on Android (server: usercollections.py). A group of
 * versions (emugrp:…) sends every version, so the phone finds whichever one it has. Steam collections and
 * categories without EmuStart games are left out — nothing in them can be played on the phone.
 */
export function emuCollections(p: Prefs, sidsOf: (gameId: string) => string[]): EmuCollection[] {
  const games = new Map<string, Set<string>>()
  for (const [gameId, cats] of Object.entries(p.gameCategories ?? {})) {
    const sids = sidsOf(gameId)
    for (const cat of sids.length ? cats : []) {
      const set = games.get(cat) ?? new Set<string>()
      sids.forEach((sid) => set.add(sid))
      games.set(cat, set)
    }
  }
  return p.categories.flatMap((cat) => {
    const ids = games.get(cat.id)
    return cat.kind === 'custom' && cat.name.trim() && ids?.size ? [{ id: cat.id, name: cat.name.trim(), games: [...ids] }] : []
  })
}

/** `file` choices waiting for upload: [game, kind, path] */
export function pendingFiles(p: Prefs): [string, ArtKind, string][] {
  const out: [string, ArtKind, string][] = []
  for (const [gameId, a] of Object.entries(p.art))
    for (const kind of KINDS) {
      const c = a[kind]
      if (c?.type === 'file') out.push([gameId, kind, c.file])
    }
  return out
}
