import { EventEmitter } from 'node:events'
import { existsSync, promises as fs, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { ThemePackage } from '@shared/types'
import type { EmustartEngine } from './emustart/engine'
import { log } from './logger'

/**
 * Motywy trybu TV z paczek wgranych na serwer EmuStart (etap 14). Pobiera i sprawdza je silnik (themes_sync —
 * engine/emustart/themes.py: tylko zmienione pliki, każdy zgodny z indeksem serwera, cały motyw sprawdzony jak na
 * serwerze) do `LumenData/themes/<id>/`. Tu: lista dla interfejsu i pliki dla protokołu lumen-theme:// — wyłącznie
 * pliki z listy pakietu (`.theme-info.json` → sha), ścieżka sprawdzona jeszcze raz (Lumen działa jako administrator).
 */

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/
const SYNC_EVERY_MS = 30 * 60_000
export const THEME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2'
}

interface Info extends Omit<ThemePackage, 'hasLayers' | 'rev'> {
  sha?: Record<string, string>
}

const str = (v: unknown, n: number): string => (typeof v === 'string' ? v.slice(0, n) : '')
const strs = (v: unknown, n: number): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, n) : [])

/** `.theme-info.json` → opis dla interfejsu (silnik go sprawdził; tu tylko kształt i nic ponad listę pól) */
export function packageOf(id: string, raw: unknown): ThemePackage | null {
  const i = raw as Partial<Info> | null
  if (!i || typeof i !== 'object' || i.id !== id || !ID.test(id) || !i.sha || typeof i.sha !== 'object') return null
  const sha = i.sha as Record<string, string>
  if (!sha['theme.css'] || !sha['theme.json']) return null
  const p = i.palette
  return {
    id,
    name: str(i.name, 40) || id,
    description: str(i.description, 300),
    author: str(i.author, 60),
    version: str(i.version, 20),
    palette: p && typeof p === 'object' ? { bg: p.bg, text: p.text, dim: p.dim, accent: p.accent, selText: p.selText, selBg: p.selBg, panel: p.panel } : undefined,
    games: { layout: i.games?.layout === 'coverflow' ? 'coverflow' : 'list', reflection: !!i.games?.reflection },
    logoPlate: !!i.logoPlate,
    consoleBackdrop: !!i.consoleBackdrop,
    ambient: i.ambient === 'embers' || i.ambient === 'stars' ? i.ambient : 'none',
    locks: strs(i.locks, 40),
    fonts: { text: strs(i.fonts?.text, 8), head: strs(i.fonts?.head, 8) },
    fontFaces: Array.isArray(i.fontFaces)
      ? i.fontFaces.filter((f) => f && typeof f.name === 'string' && typeof f.file === 'string' && f.file in sha).slice(0, 12)
      : [],
    animations: strs(i.animations, 4),
    categories: Object.fromEntries(Object.entries(i.categories ?? {}).filter(([, v]) => typeof v === 'string' && v in sha)),
    hasLayers: 'layers.html' in sha,
    rev: (sha['theme.css'] + sha['theme.json'] + (sha['layers.html'] ?? '')).replace(/[^0-9a-f]/g, '').slice(0, 16)
  }
}

export class ThemeStore extends EventEmitter {
  private cache: { pkg: ThemePackage; sha: Record<string, string> }[] | null = null
  private timer: NodeJS.Timeout | undefined
  private busy = false

  constructor(
    readonly dir: string,
    private engine: EmustartEngine
  ) {
    super()
    engine.on('state', (s: string) => {
      if (s === 'ready') {
        void this.sync()
        clearInterval(this.timer)
        this.timer = setInterval(() => void this.sync(), SYNC_EVERY_MS)
        this.timer.unref?.()
      } else clearInterval(this.timer)
    })
  }

  private read(): { pkg: ThemePackage; sha: Record<string, string> }[] {
    if (this.cache) return this.cache
    const out: { pkg: ThemePackage; sha: Record<string, string> }[] = []
    if (existsSync(this.dir)) {
      for (const d of readdirSync(this.dir, { withFileTypes: true })) {
        if (!d.isDirectory() || !ID.test(d.name)) continue
        try {
          const raw = JSON.parse(readFileSync(path.join(this.dir, d.name, '.theme-info.json'), 'utf8')) as Info
          const pkg = packageOf(d.name, raw)
          if (pkg) out.push({ pkg, sha: raw.sha ?? {} })
        } catch {
          /* niekompletny motyw — pomijany */
        }
      }
    }
    return (this.cache = out.sort((a, b) => a.pkg.name.localeCompare(b.pkg.name, 'pl')))
  }

  list(): ThemePackage[] {
    return this.read().map((t) => t.pkg)
  }

  /** Plik motywu dla lumen-theme:// — tylko z listy pakietu, ścieżka wewnątrz jego folderu; null — nie ma. */
  file(id: string, rel: string): string | null {
    if (!ID.test(id)) return null
    const t = this.read().find((x) => x.pkg.id === id)
    if (!t || !(rel in t.sha) || rel.startsWith('.')) return null
    const base = path.resolve(this.dir, id)
    const p = path.resolve(base, rel)
    return p.startsWith(base + path.sep) ? p : null
  }

  /** Motywy z serwera (silnik). Zmiana — zdarzenie „change” z nową listą. */
  async sync(): Promise<{ ok: boolean; reason?: string }> {
    if (this.busy || this.engine.state !== 'ready') return { ok: false, reason: 'silnik EmuStart nie działa' }
    this.busy = true
    try {
      const before = JSON.stringify(this.list().map((t) => [t.id, t.rev]))
      const r = await this.engine.call<{ ok: boolean; reason?: string; changed?: number; failed?: Record<string, string> }>('themes_sync', [this.dir], 300_000)
      for (const [id, why] of Object.entries(r.failed ?? {})) log.warn('themes', `${id}: ${why}`)
      this.cache = null
      const after = JSON.stringify(this.list().map((t) => [t.id, t.rev]))
      if (before !== after) {
        log.info('themes', `motywy z serwera: ${this.list().map((t) => `${t.id} ${t.version}`).join(', ') || 'brak'}`)
        this.emit('change', this.list())
      }
      return r.ok ? { ok: true } : { ok: false, reason: r.reason }
    } catch (e) {
      return { ok: false, reason: (e as Error).message }
    } finally {
      this.busy = false
    }
  }

  async response(url: string): Promise<Response> {
    const u = new URL(url)
    const rel = decodeURIComponent(u.pathname.replace(/^\/+/, ''))
    const f = this.file(u.hostname, rel)
    if (!f) return new Response('not found', { status: 404 })
    const data = await fs.readFile(f).catch(() => null)
    if (!data) return new Response('not found', { status: 404 })
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        'Content-Type': THEME_TYPES[path.extname(f).toLowerCase()] ?? 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'max-age=31536000'
      }
    })
  }
}
