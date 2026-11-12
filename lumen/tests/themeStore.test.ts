import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Motywy TV z paczek (etap 14b): lista dla interfejsu, pliki dla lumen-theme:// — tylko z listy pakietu
vi.mock('../src/main/logger', () => ({ log: { info: () => undefined, warn: () => undefined, error: () => undefined } }))
const { ThemeStore, packageOf } = await import('../src/main/themes')

const SHA = { 'theme.json': 'a'.repeat(64), 'theme.css': 'b'.repeat(64), 'layers.html': 'c'.repeat(64), 'assets/bg.webp': 'd'.repeat(64) }
const INFO = {
  id: 'portal-nexus',
  name: 'Portal Nexus',
  version: '1.0',
  palette: { bg: '#05010f', text: '#f4ecff', dim: '#c5b4eb', accent: '#2de2ff', selText: '#05010f', selBg: '#2de2ff', panel: 'rgba(0,0,0,.8)' },
  games: { layout: 'coverflow', reflection: true },
  ambient: 'stars',
  fonts: { text: ['atkinson'], head: ['atkinson'] },
  fontFaces: [{ name: 'x', file: 'assets/missing.woff2' }],
  categories: { 'family:pc': 'assets/bg.webp', 'family:nes': 'assets/none.webp' },
  animations: ['off', 'low', 'med', 'high'],
  sha: SHA
}

function themesDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lumen-themes-'))
  const t = path.join(dir, 'portal-nexus')
  mkdirSync(path.join(t, 'assets'), { recursive: true })
  writeFileSync(path.join(t, '.theme-info.json'), JSON.stringify(INFO))
  writeFileSync(path.join(t, 'theme.css'), '.tv{}')
  writeFileSync(path.join(t, 'theme.json'), '{}')
  writeFileSync(path.join(t, 'layers.html'), '<i></i>')
  writeFileSync(path.join(t, 'assets', 'bg.webp'), 'RIFF')
  writeFileSync(path.join(t, 'notes.txt'), 'nie z pakietu')
  writeFileSync(path.join(dir, 'secret.txt'), 'poza motywem')
  return dir
}

class FakeEngine extends EventEmitter {
  state = 'ready'
  calls: unknown[][] = []
  constructor(private onSync: () => void) {
    super()
  }
  async call<T>(name: string, args: unknown[]): Promise<T> {
    this.calls.push([name, ...args])
    this.onSync()
    return { ok: true, changed: 1, failed: {} } as T
  }
}

describe('motywy z paczek — proces główny', () => {
  it('opis z .theme-info.json: pola znane, odwołania tylko do plików pakietu', () => {
    const p = packageOf('portal-nexus', INFO)!
    expect(p.games).toEqual({ layout: 'coverflow', reflection: true })
    expect(p.hasLayers).toBe(true)
    expect(p.fontFaces).toEqual([]) // plik czcionki spoza pakietu
    expect(p.categories).toEqual({ 'family:pc': 'assets/bg.webp' })
    expect(p.rev).toMatch(/^[0-9a-f]{16}$/)
    expect(packageOf('inny-id', INFO)).toBeNull()
    expect(packageOf('portal-nexus', { ...INFO, sha: { 'theme.json': 'x' } })).toBeNull()
  })

  it('lumen-theme:// — tylko pliki z listy pakietu, nic spoza folderu motywu', async () => {
    const store = new ThemeStore(themesDir(), new FakeEngine(() => undefined) as never)
    expect(store.list().map((t) => t.id)).toEqual(['portal-nexus'])
    const ok = await store.response('lumen-theme://portal-nexus/theme.css')
    expect(ok.status).toBe(200)
    expect(ok.headers.get('Content-Type')).toBe('text/css; charset=utf-8')
    expect(await ok.text()).toBe('.tv{}')
    expect((await store.response('lumen-theme://portal-nexus/assets/bg.webp')).headers.get('Content-Type')).toBe('image/webp')
    for (const bad of ['notes.txt', '.theme-info.json', '../secret.txt', '..%2Fsecret.txt', 'assets/../../secret.txt'])
      expect((await store.response(`lumen-theme://portal-nexus/${bad}`)).status, bad).toBe(404)
    expect((await store.response('lumen-theme://..%2F/secret.txt')).status).toBe(404)
  })

  it('synchronizacja przez silnik: themes_sync do folderu motywów, zmiana — zdarzenie z nową listą', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'lumen-themes-'))
    const engine = new FakeEngine(() => {
      const t = path.join(dir, 'portal-nexus')
      mkdirSync(t, { recursive: true })
      writeFileSync(path.join(t, '.theme-info.json'), JSON.stringify(INFO))
    })
    const store = new ThemeStore(dir, engine as never)
    const seen: unknown[] = []
    store.on('change', (l) => seen.push(l))
    expect(store.list()).toEqual([])
    expect(await store.sync()).toEqual({ ok: true })
    expect(engine.calls).toEqual([['themes_sync', dir]])
    expect((seen[0] as { id: string }[]).map((t) => t.id)).toEqual(['portal-nexus'])
  })
})
