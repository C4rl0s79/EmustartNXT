import { DatabaseSync } from 'node:sqlite'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

// Lumen reads EmuStart's local files itself — game art, platform logos, art uploaded to the server. The
// EmuStart engine is only for exchanging data with the server: it is asked for a file only when the file
// is not on this PC yet (it then downloads it into the same places, read from here again). Asking the
// engine for local files made every picture depend on the engine being up: shown before it, a logo failed
// and stayed a name for the session.
//
// Where the engine keeps them (engine/emustart/mediastore.py, paths.py, artsync.py):
//   <EmuStart data>/data/media/<store>.media   SQLite, table art(file, data, mtime) — one per system,
//                                              plus _systems (platform logos), _stany, _logopack
//   <EmuStart data>/data/media/<store>/<file>  an older loose file not moved into the store yet
//   <EmuStart data>/data/userart-cache/<sha>.<ext>   art uploaded to the server (by any account)
//   <engine>/assets/systems.media (built) or assets/systems/*.png (sources)   built-in platform logos
// Addresses are the engine's: /media/<store>/<file>, /assets/systems/<file>.

const STORE = /^(?:[A-Za-z0-9][A-Za-z0-9._+-]{0,63}|_systems|_stany|_logopack)$/
const SHA = /^[0-9a-f]{64}$/
const USER_EXT = new Set(['png', 'jpg', 'webp', 'gif'])

const TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml'
}
export const mediaType = (file: string): string => TYPES[path.extname(file).slice(1).toLowerCase()] ?? 'application/octet-stream'

/** a single file name: no folders, no '..' (the address comes from the library) */
const plainName = (f: string): boolean => !!f && f !== '.' && f !== '..' && !/[\\/\x00]/.test(f)

export type MediaAddress = { kind: 'media'; store: string; file: string } | { kind: 'assets'; file: string }

/** The engine's address of a picture (with or without host and query) → where it lives. null: not a local one. */
export function mediaAddress(url: string): MediaAddress | null {
  let p: string
  try {
    p = decodeURIComponent(new URL(url, 'http://local').pathname)
  } catch {
    return null
  }
  const media = /^\/media\/([^/]+)\/([^/]+)$/.exec(p)
  if (media && STORE.test(media[1]) && plainName(media[2])) return { kind: 'media', store: media[1], file: media[2] }
  const assets = /^\/assets\/systems\/([^/]+)$/.exec(p)
  if (assets && plainName(assets[1])) return { kind: 'assets', file: assets[1] }
  return null
}

/**
 * A platform logo in SVG without its own size (no width / height, or in %) gets one from the viewBox — an
 * image without a size is 0×0 in a logo frame. A given dimension stays, the missing one follows the
 * viewBox's proportions. Port of the engine's logos.svg_sized (it does this when serving platform logos).
 */
export function svgSized(data: Buffer): Buffer {
  const head = data.subarray(0, 5000).toString('latin1')
  const m = /<svg\b[^>]*>/s.exec(head)
  if (!m) return data
  const tag = m[0]
  const size = (name: string): number | null => {
    const v = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>/]+))`).exec(tag)
    const raw = (v ? (v[1] ?? v[2] ?? v[3] ?? '') : '').trim()
    const num = /^([0-9]*\.?[0-9]+)(px)?$/.exec(raw)
    return num && Number(num[1]) > 0 ? Number(num[1]) : null
  }
  let w = size('width')
  let h = size('height')
  if (w && h) return data
  const vb = /viewBox\s*=\s*["']([^"']+)["']/.exec(tag)
  const nums = vb ? vb[1].trim().split(/[\s,]+/).map(Number) : []
  const vw = nums[2]
  const vh = nums[3]
  if (!(vw > 0) || !(vh > 0)) return data
  if (w) h = (w * vh) / vw
  else if (h) w = (h * vw) / vh
  else [w, h] = [vw, vh]
  const fmt = (n: number): string => String(Number(n.toPrecision(6)))
  const tag2 = tag.replace(/\s(?:width|height)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>/]+)/g, '').replace('<svg', `<svg width="${fmt(w!)}" height="${fmt(h!)}"`)
  return Buffer.concat([data.subarray(0, m.index), Buffer.from(tag2, 'latin1'), data.subarray(m.index + tag.length)])
}

export interface LocalMediaPaths {
  /** EmuStart's data folder (EMUSTART_HOME) */
  home: () => string
  /** the engine's bundled assets folder (assets/ next to the engine) */
  assets: () => string
}

/** stores not read for this long are closed: Windows does not let the engine delete or replace an open file */
const IDLE_CLOSE_MS = 30_000

export class LocalMedia {
  /** open stores, by file path (opened read-only; the engine writes them in WAL mode) */
  private dbs = new Map<string, DatabaseSync>()
  private idle: NodeJS.Timeout | undefined

  constructor(private readonly paths: LocalMediaPaths) {}

  private store(file: string): DatabaseSync | null {
    clearTimeout(this.idle)
    this.idle = setTimeout(() => this.close(), IDLE_CLOSE_MS)
    this.idle.unref?.()
    const hit = this.dbs.get(file)
    if (hit) return hit
    if (!existsSync(file)) return null // not downloaded yet — looked for again next time
    try {
      const db = new DatabaseSync(file, { readOnly: true })
      this.dbs.set(file, db)
      return db
    } catch {
      return null
    }
  }

  private row(dbFile: string, name: string): Buffer | null {
    const db = this.store(dbFile)
    if (!db) return null
    try {
      const r = db.prepare('SELECT data FROM art WHERE file = ?').get(name) as { data?: Uint8Array } | undefined
      return r?.data ? Buffer.from(r.data) : null
    } catch {
      // a store replaced under us (a new download, the engine moving files): open it again next time
      this.dbs.get(dbFile)?.close()
      this.dbs.delete(dbFile)
      return null
    }
  }

  private file(p: string): Buffer | null {
    try {
      return readFileSync(p)
    } catch {
      return null
    }
  }

  /** A picture by the engine's address, from this PC; null when it is not here (ask the engine to fetch it). */
  read(url: string): { body: Buffer; type: string } | null {
    const a = mediaAddress(url)
    if (!a) return null
    let body: Buffer | null
    if (a.kind === 'assets') {
      const dir = this.paths.assets()
      const packed = path.join(dir, 'systems.media')
      body = existsSync(packed) ? this.row(packed, a.file) : this.file(path.join(dir, 'systems', a.file))
    } else {
      const media = path.join(this.paths.home(), 'data', 'media')
      body = this.row(path.join(media, `${a.store}.media`), a.file) ?? this.file(path.join(media, a.store, a.file))
    }
    if (!body) return null
    const type = mediaType(a.file)
    if (a.kind === 'media' && a.store === '_systems' && type === 'image/svg+xml') body = svgSized(body)
    return { body, type }
  }

  /** Art uploaded to the server, when it is on this PC already (the engine downloads a missing one). */
  userArt(sha: string, ext: string): string | null {
    if (!SHA.test(sha) || !USER_EXT.has(ext)) return null
    const p = path.join(this.paths.home(), 'data', 'userart-cache', `${sha}.${ext}`)
    return existsSync(p) ? p : null
  }

  close(): void {
    clearTimeout(this.idle)
    for (const db of this.dbs.values()) db.close()
    this.dbs.clear()
  }
}
