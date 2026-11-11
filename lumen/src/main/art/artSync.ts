import type { ArtChoice, ArtKind, ArtLayout, Prefs } from '@shared/types'
import type { NavGroup } from '@shared/libraryNav'

// Art choices and the player's own images across devices (engine/emustart/artsync.py, server: userart.py).
// Key: <layout>|<game>|<kind>. Newest choice wins; a removed choice travels as null. Local files are uploaded
// first and become `user` choices — a path on this computer never leaves it.

export const KINDS: ArtKind[] = ['grid', 'hero', 'logo', 'icon']

export interface SyncItem {
  key: string
  choice: ArtChoice | null
  at: number
}

export type ServerChoices = Record<string, { choice: ArtChoice | null; at: number }>

const key = (layout: ArtLayout, gameId: string, kind: ArtKind): string => `${layout}|${gameId}|${kind}`

/** every choice of this device. Choices older than the sync have no stamp: at = 1, older than anything synced */
export function localItems(p: Prefs): SyncItem[] {
  const out: SyncItem[] = []
  const seen = new Set<string>()
  for (const [layout, map] of [['desktop', p.art], ['tv', p.artTv]] as const)
    for (const [gameId, a] of Object.entries(map))
      for (const kind of KINDS) {
        const c = a[kind]
        if (!c || c.type === 'file') continue // uploaded first, then sent as a `user` choice
        const k = key(layout, gameId, kind)
        seen.add(k)
        out.push({ key: k, choice: c, at: p.artStamps[k] ?? 1 })
      }
  // stamps without a choice: removed here
  for (const [k, at] of Object.entries(p.artStamps)) if (!seen.has(k) && !isFileChoice(p, k)) out.push({ key: k, choice: null, at })
  return out
}

function isFileChoice(p: Prefs, k: string): boolean {
  const [layout, gameId, kind] = k.split('|')
  return (layout === 'tv' ? p.artTv : p.art)[gameId]?.[kind as ArtKind]?.type === 'file'
}

/** the server's newer choices applied to the prefs; `changed` — games whose art must reload */
export function applyServer(p: Prefs, server: ServerChoices): { prefs: Prefs; changed: string[] } {
  const art = { ...p.art }
  const artTv = { ...p.artTv }
  const artStamps = { ...p.artStamps }
  const changed = new Set<string>()
  for (const [k, v] of Object.entries(server)) {
    const [layout, gameId, kind] = k.split('|') as [ArtLayout, string, ArtKind]
    if (!gameId || !KINDS.includes(kind) || (layout !== 'desktop' && layout !== 'tv')) continue
    const map = layout === 'tv' ? artTv : art
    if (map[gameId]?.[kind]?.type === 'file') continue // waits for its upload; the local pick is newer
    const local = artStamps[k] ?? (map[gameId]?.[kind] ? 1 : 0)
    if (v.at <= local) continue
    artStamps[k] = v.at
    const cur = { ...(map[gameId] ?? {}) }
    if (v.choice) cur[kind] = v.choice
    else delete cur[kind]
    map[gameId] = cur
    changed.add(gameId)
  }
  return changed.size ? { prefs: { ...p, art, artTv, artStamps }, changed: [...changed] } : { prefs: p, changed: [] }
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

/** `file` choices waiting for upload: [layout, game, kind, path] */
export function pendingFiles(p: Prefs): [ArtLayout, string, ArtKind, string][] {
  const out: [ArtLayout, string, ArtKind, string][] = []
  for (const [layout, map] of [['desktop', p.art], ['tv', p.artTv]] as const)
    for (const [gameId, a] of Object.entries(map))
      for (const kind of KINDS) {
        const c = a[kind]
        if (c?.type === 'file') out.push([layout, gameId, kind, c.file])
      }
  return out
}
