import { afterEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { LocalMedia, mediaAddress, svgSized } from '../src/main/localMedia'

// EmuStart's folders as the engine leaves them (mediastore.py, artsync.py)
function setup(): { home: string; assets: string; lm: LocalMedia } {
  const root = mkdtempSync(path.join(tmpdir(), 'lumen-media-'))
  const home = path.join(root, 'emustart')
  const assets = path.join(root, 'assets')
  mkdirSync(path.join(home, 'data', 'media', 'snes'), { recursive: true })
  mkdirSync(path.join(home, 'data', 'userart-cache'), { recursive: true })
  mkdirSync(path.join(assets, 'systems'), { recursive: true })
  const store = (name: string, rows: [string, string][]): void => {
    const db = new DatabaseSync(path.join(home, 'data', 'media', `${name}.media`))
    db.exec('PRAGMA journal_mode=WAL')
    db.exec('CREATE TABLE art (file TEXT PRIMARY KEY, data BLOB NOT NULL, mtime REAL NOT NULL)')
    for (const [f, d] of rows) db.prepare('INSERT INTO art VALUES (?, ?, 0)').run(f, Buffer.from(d))
    db.close()
  }
  store('snes', [['Mario (USA).box.png', 'box-bytes']])
  store('_systems', [['psx.custom.svg', '<svg viewBox="0 0 300 100"><path/></svg>'], ['3do.custom.png', 'png-bytes']])
  writeFileSync(path.join(home, 'data', 'media', 'snes', 'Old (USA).snap.png'), 'loose-bytes')
  writeFileSync(path.join(assets, 'systems', 'SNES.png'), 'bundled-bytes')
  writeFileSync(path.join(home, 'data', 'userart-cache', `${'a'.repeat(64)}.png`), 'user-bytes')
  const lm = new LocalMedia({ home: () => home, assets: () => assets })
  roots.push({ root, lm })
  return { home, assets, lm }
}
const roots: { root: string; lm: LocalMedia }[] = []
afterEach(() => {
  for (const r of roots.splice(0)) {
    r.lm.close()
    rmSync(r.root, { recursive: true, force: true })
  }
})
const text = (r: { body: Buffer } | null): string | null => (r ? r.body.toString() : null)

describe('mediaAddress', () => {
  it('takes the engine addresses of game art, platform logos and built-in logos', () => {
    expect(mediaAddress('/media/snes/Mario%20(USA).box.png')).toEqual({ kind: 'media', store: 'snes', file: 'Mario (USA).box.png' })
    expect(mediaAddress('http://127.0.0.1:5000/media/_systems/psx.custom.svg?v=17')).toEqual({ kind: 'media', store: '_systems', file: 'psx.custom.svg' })
    expect(mediaAddress('/assets/systems/SNES.png')).toEqual({ kind: 'assets', file: 'SNES.png' })
  })

  it('never leaves its folders and refuses other addresses', () => {
    expect(mediaAddress('/media/snes/..%2F..%2Fsecret.txt')).toBeNull()
    expect(mediaAddress('/media/../config.json')).toBeNull()
    expect(mediaAddress('/media/_other/x.png')).toBeNull()
    expect(mediaAddress('/media/snes/a/b.png')).toBeNull()
    expect(mediaAddress('/web/index.html')).toBeNull()
  })
})

describe('LocalMedia.read', () => {
  it('reads a game picture from the system store, an older loose file next to it', () => {
    const { lm } = setup()
    expect(text(lm.read('/media/snes/Mario%20(USA).box.png'))).toBe('box-bytes')
    expect(lm.read('/media/snes/Mario%20(USA).box.png')?.type).toBe('image/png')
    expect(text(lm.read('/media/snes/Old%20(USA).snap.png'))).toBe('loose-bytes')
  })

  it('reads platform logos from _systems — an SVG without a size gets one from its viewBox', () => {
    const { lm } = setup()
    expect(text(lm.read('/media/_systems/3do.custom.png?v=1'))).toBe('png-bytes')
    const svg = lm.read('/media/_systems/psx.custom.svg')
    expect(svg?.type).toBe('image/svg+xml')
    expect(text(svg)).toBe('<svg width="300" height="100" viewBox="0 0 300 100"><path/></svg>')
  })

  it('reads built-in logos from the engine assets (files from sources, the packed store when built)', () => {
    const { lm, assets } = setup()
    expect(text(lm.read('/assets/systems/SNES.png'))).toBe('bundled-bytes')
    const db = new DatabaseSync(path.join(assets, 'systems.media'))
    db.exec('CREATE TABLE art (file TEXT PRIMARY KEY, data BLOB NOT NULL, mtime REAL NOT NULL)')
    db.prepare('INSERT INTO art VALUES (?, ?, 0)').run('SNES.png', Buffer.from('packed-bytes'))
    db.close()
    const built = new LocalMedia({ home: () => '', assets: () => assets })
    expect(text(built.read('/assets/systems/SNES.png'))).toBe('packed-bytes')
    built.close() // Windows does not delete an open store
  })

  it('a picture not on this PC (not downloaded yet, no store) → null: the engine fetches it', () => {
    const { lm } = setup()
    expect(lm.read('/media/snes/Missing.box.png')).toBeNull()
    expect(lm.read('/media/psx/Any.box.png')).toBeNull()
    expect(lm.read('/assets/systems/NONE.png')).toBeNull()
  })
})

describe('LocalMedia.userArt', () => {
  it('finds art uploaded to the server when it is on this PC; checks the name', () => {
    const { lm, home } = setup()
    expect(lm.userArt('a'.repeat(64), 'png')).toBe(path.join(home, 'data', 'userart-cache', `${'a'.repeat(64)}.png`))
    expect(lm.userArt('b'.repeat(64), 'png')).toBeNull()
    expect(lm.userArt('../x', 'png')).toBeNull()
    expect(lm.userArt('a'.repeat(64), 'exe')).toBeNull()
  })
})

describe('svgSized (engine logos.svg_sized)', () => {
  const s = (x: string): string => svgSized(Buffer.from(x)).toString()
  it('keeps an SVG with its own size, completes one dimension from the viewBox proportions', () => {
    expect(s('<svg width="10" height="5" viewBox="0 0 300 100"/>')).toBe('<svg width="10" height="5" viewBox="0 0 300 100"/>')
    expect(s('<svg width="60" viewBox="0 0 300 100">')).toBe('<svg width="60" height="20" viewBox="0 0 300 100">')
    expect(s('<svg height="100%" viewBox="0,0,40,10">')).toBe('<svg width="40" height="10" viewBox="0,0,40,10">')
  })
  it('leaves files without an svg tag or a usable viewBox', () => {
    expect(s('PNG')).toBe('PNG')
    expect(s('<svg>')).toBe('<svg>')
  })
})
