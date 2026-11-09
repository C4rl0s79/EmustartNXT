import { describe, expect, it } from 'vitest'
import type { EmuSystem, Game, PlatformInfo, Prefs } from '@shared/types'
import { buildNav, classify, classifyContext, findSub, pinnedSubs, platformForTag } from '@shared/libraryNav'
import { defaultPrefs, migratePrefs, ops, PrefsError } from '../src/main/store/prefs'

const CATALOG: PlatformInfo[] = [
  { es: 'ps2', display: 'PlayStation 2', plat: 'PS2', family: 'console' },
  { es: 'gba', display: 'Game Boy Advance', plat: 'GBA', family: 'console' },
  { es: 'amiga', display: 'Amiga', plat: 'AMIGA', family: 'computer' },
  { es: 'c64', display: 'Commodore 64', plat: 'C64', family: 'computer' },
  { es: 'mame', display: 'MAME', plat: 'MAME', family: 'arcade' }
]
const SYSTEMS: EmuSystem[] = [
  { es: 'ps2', display: 'PlayStation 2', games: 1, cached: 0, emulator: 'PCSX2', family: 'console' },
  { es: 'amiga', display: 'Amiga', games: 1, cached: 0, emulator: 'WinUAE', family: 'computer' },
  { es: 'mame', display: 'MAME', games: 1, cached: 0, emulator: 'MAME', family: 'arcade' },
  { es: 'dziwny', display: 'Dziwny system', games: 1, cached: 0, emulator: '' }
]

const base = (id: string, source: Game['source'], name: string, extra: Partial<Game> = {}): Game => ({
  id,
  source,
  appId: 0,
  name,
  sortName: name.toLowerCase(),
  provenance: [],
  installState: 'installed',
  installed: true,
  ...extra
})
const emu = (es: string, name: string): Game =>
  base(`emu:${es}/${name}`, 'emustart', name, { emu: { id: 1, sid: `${es}/${name}`, es, system: es, tags: '', size: 1, cached: false, pinned: false, copying: false, discs: 1, hasBox: false, hasSnap: false, hasLogo: false } })
const shortcut = (appId: number, name: string, exe: string, tags: string[] = []): Game =>
  base(`shortcut:${appId}`, 'shortcut', name, { appId, shortcut: { exe, tags, gameId64: '1' } })

const ctx = (overrides: Record<string, string> = {}) => classifyContext(SYSTEMS, CATALOG, overrides)

describe('platform classification', () => {
  it('Steam and GOG are PC, separate subgroups, never merged by title', () => {
    expect(classify(base('steam:10', 'steam', 'Wiedźmin 3'), ctx())).toEqual({ family: 'pc', id: 'steam', label: 'Steam' })
    expect(classify(base('gog:1207664643', 'gog', 'Wiedźmin 3'), ctx())).toEqual({ family: 'pc', id: 'gog', label: 'GOG' })
  })

  it('EmuStart games follow the system catalog family; unknown systems go to Pozostałe', () => {
    expect(classify(emu('ps2', 'Gra'), ctx())).toMatchObject({ family: 'console', id: 'emu:ps2', label: 'PlayStation 2' })
    expect(classify(emu('amiga', 'Gra'), ctx())).toMatchObject({ family: 'computer' })
    expect(classify(emu('mame', 'Gra'), ctx())).toMatchObject({ family: 'arcade' })
    expect(classify(emu('dziwny', 'Gra'), ctx())).toMatchObject({ family: 'other', id: 'emu:dziwny', label: 'Dziwny system' })
  })

  it('Steam shortcuts: platform from tags, emulator without a tag is ambiguous, others are PC', () => {
    expect(classify(shortcut(1, 'GT4', 'D:\\Emu\\pcsx2-qt.exe', ['PS2']), ctx())).toMatchObject({ family: 'console', id: 'emu:ps2' })
    expect(classify(shortcut(2, 'Turrican', 'D:\\Emu\\winuae64.exe', ['Amiga']), ctx())).toMatchObject({ family: 'computer', id: 'emu:amiga' })
    expect(classify(shortcut(3, 'Coś', 'D:\\RetroArch\\retroarch.exe'), ctx())).toMatchObject({ family: 'other', id: 'other:shortcut' })
    expect(classify(shortcut(4, 'Epic gra', 'C:\\Games\\Gra\\gra.exe'), ctx())).toMatchObject({ family: 'pc', id: 'shortcut' })
  })

  it('manual override for an ambiguous shortcut', () => {
    const g = shortcut(3, 'Coś', 'D:\\RetroArch\\retroarch.exe')
    expect(classify(g, ctx({ [g.id]: 'emu:gba' }))).toMatchObject({ family: 'console', id: 'emu:gba', label: 'Game Boy Advance', manual: true })
    expect(classify(g, ctx({ [g.id]: 'pc' }))).toMatchObject({ family: 'pc', id: 'shortcut', manual: true })
  })

  it('tag matching uses es, plat code and display name', () => {
    expect(platformForTag('playstation 2', CATALOG)?.es).toBe('ps2')
    expect(platformForTag('C64', CATALOG)?.es).toBe('c64')
    expect(platformForTag('commodore 64', CATALOG)?.es).toBe('c64')
    expect(platformForTag('Non-Steam', CATALOG)).toBeUndefined()
  })
})

describe('navigation tree', () => {
  const games = [
    base('steam:10', 'steam', 'B Steam', { lastPlayed: 50 }),
    base('gog:1', 'gog', 'A GOG'),
    emu('ps2', 'Gra PS2'),
    emu('amiga', 'Gra Amiga'),
    emu('dziwny', 'Gra X'),
    shortcut(1, 'GT4', 'x\\pcsx2.exe', ['PS2'])
  ].map((g) => ({ ...g, platform: classify(g, ctx()) }))

  it('families with subgroups generated from the library, PC = Wszystkie / Steam / GOG', () => {
    const nav = buildNav(games, defaultPrefs(), null)
    expect(nav.map((g) => g.id)).toEqual(['pc', 'computer', 'console', 'other', 'fav', 'recent'])
    const pc = nav.find((g) => g.id === 'pc')!
    expect(pc.subs.map((s) => s.label)).toEqual(['Wszystkie', 'Steam', 'GOG'])
    expect(pc.subs[0].games.map((g) => g.name)).toEqual(['A GOG', 'B Steam'])
    const con = nav.find((g) => g.id === 'console')!
    expect(con.subs.map((s) => s.id)).toEqual(['console/all', 'console/emu:ps2'])
    expect(con.subs[1].games.map((g) => g.id).sort()).toEqual(['emu:ps2/Gra PS2', 'shortcut:1'])   // shortcut and EmuStart in one platform
    expect(nav.find((g) => g.id === 'arcade')).toBeUndefined()                                    // no empty family
    expect(nav.find((g) => g.id === 'other')!.subs[1].label).toBe('Dziwny system')               // unknown — shown, not hidden
  })

  it('collections, favourites and history reference the same game records', () => {
    let p = ops.createCategory(defaultPrefs(), 'RPG', 'cat:rpg')
    p = ops.setGameCategories(p, 'gog:1', ['cat:rpg'])
    p = ops.toggleFavorite(p, 'gog:1')
    const nav = buildNav(games, p, null)
    const col = nav.find((g) => g.id === 'col')!
    const fav = nav.find((g) => g.id === 'fav')!
    const gogInPc = nav.find((g) => g.id === 'pc')!.subs.find((s) => s.id === 'pc/gog')!.games[0]
    expect(col.subs[0].games[0]).toBe(gogInPc)
    expect(fav.games[0]).toBe(gogInPc)
    expect(nav.find((g) => g.id === 'recent')!.games.map((g) => g.id)).toEqual(['steam:10'])
  })

  it('pins resolve to subgroups; a pin of a vanished platform is kept but not shown', () => {
    const nav = buildNav(games, defaultPrefs(), null)
    expect(findSub(nav, 'pc/gog')?.sub.games.length).toBe(1)
    expect(pinnedSubs(nav, ['console/emu:ps2', 'console/emu:snes', 'pc/gog']).map((x) => x.sub.id)).toEqual(['console/emu:ps2', 'pc/gog'])
  })
})

describe('prefs v4', () => {
  it('migrates pinned Lumen categories and Steam collections to group pins, keeps everything else', () => {
    const v3 = {
      version: 3,
      categories: [
        { id: 'smart:all', name: 'Steam', kind: 'smart', smart: 'all', pinned: true, order: 0 },
        { id: 'emusys:ps2', name: 'PlayStation 2', kind: 'emustart', emuSystem: 'ps2', pinned: true, order: 1 },
        { id: 'steamcol:x', name: 'Ulubione RPG', kind: 'steam', steamCollectionId: 'x', pinned: true, order: 3 },
        { id: 'cat:a', name: 'Moje', kind: 'custom', pinned: true, order: 2 },
        { id: 'cat:b', name: 'Inne', kind: 'custom', pinned: false, order: 4 }
      ],
      gameCategories: { 'steam:1': ['cat:a'] },
      favorites: ['steam:1', 'emu:ps2/x'],
      art: { 'steam:1': { grid: { type: 'steam' } } },
      artTv: {},
      versions: { 'emugrp:a': 'emu:b' }
    }
    const p = migratePrefs(v3)
    expect(p.version).toBe(4)
    expect(p.pinnedGroups).toEqual(['col/cat:a', 'col/steamcol:x'])
    expect(p.favorites).toEqual(['steam:1', 'emu:ps2/x'])
    expect(p.gameCategories).toEqual({ 'steam:1': ['cat:a'] })
    expect(p.art['steam:1']).toEqual({ grid: { type: 'steam' } })
    expect(p.versions).toEqual({ 'emugrp:a': 'emu:b' })
    expect(p.categories.find((c) => c.id === 'emusys:ps2')?.pinned).toBe(true)        // old flag untouched
    expect(migratePrefs(p).pinnedGroups).toEqual(p.pinnedGroups)                        // idempotent
  })

  it('validates overrides and pins', () => {
    let p = defaultPrefs()
    p = ops.setPlatformOverride(p, 'shortcut:5', 'emu:ps2')
    expect(p.platformOverrides).toEqual({ 'shortcut:5': 'emu:ps2' })
    expect(() => ops.setPlatformOverride(p, 'steam:5', 'pc')).toThrow(PrefsError)
    expect(() => ops.setPlatformOverride(p, 'shortcut:5', 'emu:../x')).toThrow(PrefsError)
    p = ops.setPlatformOverride(p, 'shortcut:5', undefined)
    expect(p.platformOverrides).toEqual({})
    p = ops.setGroupPinned(p, 'console/emu:ps2', true)
    p = ops.setGroupPinned(p, 'pc/gog', true)
    p = ops.moveGroupPin(p, 'pc/gog', -1)
    expect(p.pinnedGroups).toEqual(['pc/gog', 'console/emu:ps2'])
    expect(() => ops.setGroupPinned(p, '../../x', true)).toThrow(PrefsError)
    const bad = migratePrefs({ ...p, pinnedGroups: ['pc/gog', 'zły', 5], platformOverrides: { 'shortcut:1': 'emu:a b' } } as unknown as Prefs)
    expect(bad.pinnedGroups).toEqual(['pc/gog'])
    expect(bad.platformOverrides).toEqual({})
  })
})

describe('duża biblioteka (40 tys. gier)', () => {
  it('buildNav sortuje po polsku i mieści się w ułamku sekundy', () => {
    const names = ['Żółw', 'Ćma', 'Ala', 'ąbc', 'Zebra']
    const games: Game[] = []
    for (let i = 0; i < 40_000; i++) games.push({ ...emu(i % 2 ? 'snes' : 'ps2', `${names[i % names.length]} ${i}`), platform: classify(emu(i % 2 ? 'snes' : 'ps2', 'x'), ctx()) })
    const t = performance.now()
    const nav = buildNav(games, defaultPrefs(), null)
    const ms = performance.now() - t
    const all = nav.find((g) => g.id === 'console')!.games.map((g) => g.name.split(' ')[0])
    expect(all.indexOf('Ala')).toBeLessThan(all.indexOf('ąbc'))
    expect(all.indexOf('ąbc')).toBeLessThan(all.indexOf('Ćma'))
    expect(all.lastIndexOf('Zebra')).toBeLessThan(all.indexOf('Żółw'))
    expect(ms).toBeLessThan(1500)                     // localeCompare z opcjami: kilka sekund
  })
})
