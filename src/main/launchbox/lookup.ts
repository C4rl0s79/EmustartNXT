import type { DatabaseSync } from 'node:sqlite'
import type { GameDetails } from '@shared/types'
import { editionless, normTitle, numbersMatch, plainTitle, similarity } from './match'

// Queries on the LaunchBox SQLite file (schema compatible with EmuStart's launchbox.db).

export interface GameRow {
  id: number
  name: string
  platform: string
  year: string
  overview: string
  developer: string
  publisher: string
  genres: string
  players: string
  rating: string
  // schema 3 (absent in an older database until it is rebuilt)
  rating_count?: string
  esrb?: string
  coop?: string
  release_type?: string
}

export function findGame(db: DatabaseSync, name: string, platform: string | undefined): GameRow | null {
  const direct = findTitle(db, name, platform, true)
  if (direct || !platform) return direct
  // Shortcut names often carry a series or subtitle after " - ": "Blood Omen 2 - The Legacy of Kain
  // Series", "Legacy of Kain - Soul Reaver 2". Try each part, exact key only (no prefix guessing).
  const parts = plainTitle(name)
    .split(/\s+-\s+/)
    .filter((p) => normTitle(p).length >= 6)
  if (parts.length < 2) return null
  for (const p of parts) {
    const hit = findTitle(db, p, platform, false)
    if (hit) return hit
  }
  return null
}

/** match key of a store title without its edition: "The Witcher 3: Wild Hunt - GOTY Edition" = "The Witcher 3 Wild Hunt" */
function baseKey(name: string): string {
  const shorter = editionless(name)
  return normTitle(shorter.length ? shorter[shorter.length - 1] : name)
}

/** match key of the main title, before a subtitle: "The Witcher 2: Assassins of Kings" = "The Witcher 2" */
function mainKey(name: string): string {
  return normTitle(plainTitle(name).split(/:| - /)[0])
}

/**
 * A store title (GOG) in LaunchBox: the exact title first (also an alternate name), else among the entries
 * of the same game the closest to the full store title. The same game is the same title without the
 * edition ("… Game of the Year Edition" ↔ the plain title), or the store title is the entry's main title
 * without its subtitle ("The Witcher 2" → "The Witcher 2: Assassins of Kings"; never the other way round:
 * "Star Wars: Rebel Assault" is not "Star Wars"). Sequel numbers must agree.
 */
export function findEdition(db: DatabaseSync, name: string, platform: string): GameRow | null {
  const exact = findTitle(db, name, platform, false)
  if (exact) return exact
  const base = baseKey(name)
  if (base.length < 3) return null
  // keys are lowercase letters and digits: a range on the index instead of LIKE (which cannot use it)
  const gids = (
    db.prepare('SELECT DISTINCT gid FROM names WHERE platform=? AND norm >= ? AND norm < ? LIMIT 200').all(platform, base, base + '{') as { gid: number }[]
  ).map((g) => g.gid)
  if (!gids.length) return null
  const tier = (g: GameRow): number => (baseKey(g.name) === base ? 2 : mainKey(g.name) === base ? 1 : 0)
  const rows = (
    db.prepare(`SELECT * FROM games WHERE id IN (${gids.map(() => '?').join(',')})`).all(...gids) as unknown as GameRow[]
  ).filter((r) => tier(r) > 0 && numbersMatch(name, r.name))
  if (!rows.length) return null
  const t = plainTitle(name)
  const score = (g: GameRow): number => tier(g) + similarity(t, g.name) + (g.overview ? 0.001 : 0)
  return rows.reduce((a, b) => (score(b) > score(a) ? b : a))
}

function findTitle(db: DatabaseSync, name: string, platform: string | undefined, allowPrefix: boolean): GameRow | null {
  const n = normTitle(name)
  if (!n) return null
  const byNorm = platform
    ? db.prepare('SELECT DISTINCT gid FROM names WHERE platform=? AND norm=?')
    : db.prepare('SELECT DISTINCT gid FROM names WHERE norm=?')
  let gids = (platform ? byNorm.all(platform, n) : byNorm.all(n)) as { gid: number }[]
  if (!gids.length && allowPrefix && platform && n.length >= 12) {
    // "Final Fantasy VII (Disc 1)" and other small differences — same beginning of the key
    gids = db.prepare('SELECT DISTINCT gid FROM names WHERE platform=? AND norm LIKE ? LIMIT 20').all(platform, n.slice(0, 12) + '%') as {
      gid: number
    }[]
  }
  if (!gids.length) return null
  const rows = (
    db.prepare(`SELECT * FROM games WHERE id IN (${gids.map(() => '?').join(',')})`).all(...gids.map((g) => g.gid)) as unknown as GameRow[]
  ).filter((r) => numbersMatch(name, r.name))
  if (!rows.length) return null
  const t = plainTitle(name)
  const score = (g: GameRow): number => similarity(t, g.name) + (g.overview ? 0.001 : 0)
  const best = rows.reduce((a, b) => (score(b) > score(a) ? b : a))
  return similarity(t, best.name) >= 0.6 || rows.length === 1 ? best : null
}

export function toDetails(g: GameRow): GameDetails {
  const genres = g.genres
    .split(';')
    .map((x) => x.trim())
    .filter(Boolean)
  return {
    appId: 0,
    fetchedAt: Date.now(),
    source: 'launchbox',
    name: g.name,
    descriptionText: g.overview || undefined,
    genres: genres.length ? genres : undefined,
    releaseDate: g.year || undefined,
    developers: g.developer ? [g.developer] : undefined,
    publishers: g.publisher ? [g.publisher] : undefined,
    players: g.players || undefined,
    rating: g.rating ? Math.round(Number(g.rating) * 10) / 10 || undefined : undefined,
    platform: g.platform || undefined,
    launchboxId: g.id,
    ratingCount: Number(g.rating_count) || undefined,
    esrb: g.esrb && !/^not rated$/i.test(g.esrb) ? g.esrb : undefined,
    coop: g.coop === 'true' ? true : g.coop === 'false' ? false : undefined,
    releaseType: g.release_type || undefined
  }
}
