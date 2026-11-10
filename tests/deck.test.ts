import { describe, expect, it } from 'vitest'
import type { Game } from '@shared/types'
import type { NavGroup } from '@shared/libraryNav'
import {
  activeGroup,
  clampCols,
  cleanDeckSettings,
  deckCandidates,
  dockRect,
  defaultDeckLayout,
  defaultDeckSettings,
  layoutFor,
  mergeDeck,
  screenKey,
  syncGroups,
  visibleGroups,
  type DeckCandidate,
  type DeckGroup
} from '@shared/deck'

const games = (n: number): Game[] => Array.from({ length: n }, (_, i) => ({ id: `g${i}` }) as Game)
const g = (id: string, extra: Partial<DeckGroup> = {}): DeckGroup => ({ id, cols: 8, aspect: 'portrait', hidden: false, ...extra })
const c = (id: string, count: number, kind: DeckCandidate['kind'] = 'platform', label = id): DeckCandidate => ({ id, label, kind, count })

describe('defaults (PyLinksDeck profiles.py)', () => {
  it('starts switched off, with the dimensions PyLinksDeck used', () => {
    const s = defaultDeckSettings()
    expect(s.enabled).toBe(false)
    expect(s).toMatchObject({ showLabels: true, showLogos: true, scrollSpeed: 0.7, animations: true, autoHide: true, opacity: 0.96 })
    expect(defaultDeckLayout()).toEqual({ label: '', dockWidth: 0.86, dockHeight: 46, dockOffset: 0, panelWidth: 0.94, panelHeight: 0.8 })
  })
})

describe('clampCols', () => {
  it('keeps 1–24 columns, rounds, and falls back to 8', () => {
    expect(clampCols(0)).toBe(1)
    expect(clampCols(40)).toBe(24)
    expect(clampCols(9.6)).toBe(10)
    expect(clampCols('x')).toBe(8)
    expect(clampCols(Number.NaN)).toBe(8)
  })
})

describe('screenKey', () => {
  it('matches PyLinksDeck keys and labels', () => {
    expect(screenKey(2048, 1280, 1.25)).toEqual({ key: '2048x1280@1.25', label: '2048×1280 ×1.25' })
    expect(screenKey(1920, 1080, 1)).toEqual({ key: '1920x1080@1', label: '1920×1080' })
    expect(screenKey(1707, 1067, 1.5)).toEqual({ key: '1707x1067@1.5', label: '1707×1067 ×1.5' })
  })

  it('rounds the scale to 2 decimals (no float noise in the key)', () => {
    expect(screenKey(2560, 1440, 1.2500000001).key).toBe('2560x1440@1.25')
  })

  it('rounds a fractional logical size, so the key survives validation on load', () => {
    const { key } = screenKey(2560 / 1.5, 1600 / 1.5, 1.5)
    expect(key).toBe('1707x1067@1.5')
    expect(Object.keys(cleanDeckSettings({ screens: { [key]: {} } }).screens)).toEqual([key])
  })
})

describe('layoutFor', () => {
  it('returns the stored layout or defaults, without changing the settings', () => {
    const s = defaultDeckSettings()
    s.screens['1920x1080@1'] = { ...defaultDeckLayout('1920×1080'), dockWidth: 1 }
    expect(layoutFor(s, '1920x1080@1').dockWidth).toBe(1)
    expect(layoutFor(s, '2560x1440@1', '2560×1440')).toEqual(defaultDeckLayout('2560×1440'))
    expect(Object.keys(s.screens)).toEqual(['1920x1080@1'])
  })
})

describe('deckCandidates', () => {
  const nav: NavGroup[] = [
    { id: 'pc', label: 'PC', games: games(3), subs: [{ id: 'pc/all', label: 'Wszystkie', games: games(3) }, { id: 'pc/steam', label: 'Steam', games: games(2) }, { id: 'pc/gog', label: 'GOG', games: games(1) }] },
    { id: 'console', label: 'Konsole', games: games(4), subs: [{ id: 'console/all', label: 'Wszystkie', games: games(4) }, { id: 'console/emu:ps2', label: 'PlayStation 2', games: games(4), es: 'ps2' }] },
    { id: 'col', label: 'Kolekcje', games: [], subs: [{ id: 'col/cat:1', label: 'Tekken', games: games(2) }] },
    { id: 'fav', label: 'Ulubione', games: games(1), subs: [{ id: 'fav/all', label: 'Ulubione', games: games(1) }] },
    { id: 'recent', label: 'Ostatnio grane', games: games(1), subs: [{ id: 'recent/all', label: 'Ostatnio grane', games: games(1) }] }
  ]

  it('takes platform subgroups and collections, never "Wszystkie", Ulubione or Ostatnio grane', () => {
    const withAll = nav.map((x) => (x.id === 'col' ? { ...x, subs: [...x.subs, { id: 'col/all', label: 'Kolekcja „all”', games: games(1) }] } : x))
    expect(deckCandidates(withAll).map((x) => x.id)).toContain('col/all')
    expect(deckCandidates(nav)).toEqual([
      { id: 'pc/steam', label: 'Steam', kind: 'platform', count: 2 },
      { id: 'pc/gog', label: 'GOG', kind: 'platform', count: 1 },
      { id: 'console/emu:ps2', label: 'PlayStation 2', kind: 'platform', count: 4, es: 'ps2' },
      { id: 'col/cat:1', label: 'Tekken', kind: 'collection', count: 2 }
    ])
  })
})

describe('syncGroups (deck_app._sync_groups)', () => {
  it('appends unknown subgroups: collections first, then platforms by number of games, then name', () => {
    const out = syncGroups([], [c('console/emu:psp', 5), c('col/cat:1', 2, 'collection'), c('console/emu:ps1', 9), c('console/emu:dc', 5), c('col/cat:2', 7, 'collection')])
    expect(out.map((x) => x.id)).toEqual(['col/cat:2', 'col/cat:1', 'console/emu:ps1', 'console/emu:dc', 'console/emu:psp'])
    expect(out[0]).toEqual(g('col/cat:2'))
  })

  it('keeps existing tabs untouched — order, look, hidden, and tabs whose subgroup is gone', () => {
    const mine = [g('console/emu:ps2', { cols: 14, aspect: 'square' }), g('console/emu:gone', { hidden: true })]
    const out = syncGroups(mine, [c('console/emu:ps1', 3), c('console/emu:ps2', 1)])
    expect(out).toEqual([...mine, g('console/emu:ps1')])
  })

  it('does not add an empty subgroup, and returns the same array when nothing is new', () => {
    const mine = [g('pc/steam')]
    expect(syncGroups(mine, [c('pc/steam', 3), c('pc/gog', 0)])).toBe(mine)
  })
})

describe('visibleGroups / activeGroup', () => {
  const s = { ...defaultDeckSettings(), groups: [g('a/1'), g('a/2', { hidden: true }), g('a/3'), g('a/4')], activeGroup: 'a/3' }
  const cands = [c('a/1', 2), c('a/2', 2), c('a/3', 0), c('a/4', 1)]

  it('shows tabs not hidden by the player that have games now (an empty tab keeps its setting)', () => {
    expect(visibleGroups(s, cands).map((x) => x.id)).toEqual(['a/1', 'a/4'])
    expect(s.groups[2].hidden).toBe(false)
  })

  it('falls back to the first shown tab when the stored one is not shown', () => {
    expect(activeGroup(s, visibleGroups(s, cands))?.id).toBe('a/1')
    expect(activeGroup({ ...s, activeGroup: 'a/4' }, visibleGroups(s, cands))?.id).toBe('a/4')
    expect(activeGroup(s, [])).toBeUndefined()
  })
})

describe('cleanDeckSettings', () => {
  it('gives defaults for missing or broken data', () => {
    expect(cleanDeckSettings(undefined)).toEqual(defaultDeckSettings())
    expect(cleanDeckSettings('x')).toEqual(defaultDeckSettings())
  })

  it('round-trips valid settings', () => {
    const s = {
      ...defaultDeckSettings(),
      enabled: true,
      groups: [g('console/emu:ps2', { cols: 14 }), g('col/steam:from-tag-Gry PS2', { aspect: 'square', hidden: true })],
      activeGroup: 'console/emu:ps2',
      showLabels: false,
      scrollSpeed: 0.3,
      opacity: 1,
      screens: { '2048x1280@1.25': { ...defaultDeckLayout('2048×1280 ×1.25'), dockWidth: 1 } }
    }
    expect(cleanDeckSettings(JSON.parse(JSON.stringify(s)))).toEqual(s)
  })

  it('drops invalid and duplicate tabs, clamps values, and resets an unknown active tab', () => {
    const out = cleanDeckSettings({
      enabled: 'yes',
      groups: [{ id: 'console/emu:ps2', cols: 99, aspect: 'wide' }, { id: 'console/emu:ps2' }, { id: 'bez-ukośnika' }, { id: 5 }, null],
      activeGroup: 'console/emu:gone',
      opacity: 0,
      scrollSpeed: 'fast',
      screens: { '1920x1080@1': { dockWidth: 5, panelHeight: -1, dockHeight: 3 }, 'monitor 1': {} }
    })
    expect(out.enabled).toBe(false)
    expect(out.groups).toEqual([g('console/emu:ps2', { cols: 24 })])
    expect(out.activeGroup).toBe('')
    expect(out.opacity).toBe(0.3)
    expect(out.scrollSpeed).toBe(0.7)
    expect(out.screens).toEqual({ '1920x1080@1': { label: '', dockWidth: 1, dockHeight: 24, dockOffset: 0, panelWidth: 0.94, panelHeight: 0.1 } })
  })

  it('keeps the newest 50 screens, so a new monitor is not locked out', () => {
    const screens: Record<string, object> = {}
    for (let i = 0; i < 51; i++) screens[`${1000 + i}x800@1`] = {}
    const keys = Object.keys(cleanDeckSettings({ screens }).screens)
    expect(keys).toHaveLength(50)
    expect(keys).toContain('1050x800@1')
    expect(keys).not.toContain('1000x800@1')
  })
})

describe('mergeDeck', () => {
  const cur = { ...defaultDeckSettings(), groups: [g('console/emu:ps2', { cols: 14 })], activeGroup: 'console/emu:ps2', screens: { '1920x1080@1': { ...defaultDeckLayout(), dockWidth: 1 } } }

  it('changes only the fields given — turning Deck on keeps tabs and screens', () => {
    const out = mergeDeck(cur, { enabled: true })
    expect(out).toEqual({ ...cur, enabled: true })
  })

  it('a screens patch from the Deck window keeps the tabs; no patch returns the same object', () => {
    const screens = { ...cur.screens, '2560x1440@1': defaultDeckLayout() }
    expect(mergeDeck(cur, { screens })).toEqual({ ...cur, screens })
    expect(mergeDeck(cur, undefined)).toBe(cur)
  })
})

describe('dockRect (deck_app._layout_windows)', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 }
  it('centres the dock at the top of the work area', () => {
    expect(dockRect(area, defaultDeckLayout())).toEqual({ x: 134, y: 0, width: 1651, height: 46 })
  })
  it('follows the work area (taskbar at the top, second screen left of the primary)', () => {
    expect(dockRect({ x: -2560, y: 40, width: 2560, height: 1400 }, { ...defaultDeckLayout(), dockWidth: 1, dockOffset: 12 })).toEqual({ x: -2560, y: 52, width: 2560, height: 46 })
  })
  it('keeps at least 240 × 28 px, never wider than the screen, and ignores a negative offset', () => {
    expect(dockRect({ x: 0, y: 0, width: 200, height: 600 }, { ...defaultDeckLayout(), dockWidth: 0.1, dockHeight: 10, dockOffset: -50 })).toEqual({ x: 0, y: 0, width: 200, height: 28 })
    expect(dockRect(area, { ...defaultDeckLayout(), dockWidth: 0.1 }).width).toBe(240)
  })
  it('stays inside the work area: a layout from a taller screen never puts the dock off-screen', () => {
    expect(dockRect(area, { ...defaultDeckLayout(), dockOffset: 1200 })).toEqual({ x: 134, y: 994, width: 1651, height: 46 })
    expect(dockRect({ x: 0, y: 0, width: 800, height: 100 }, { ...defaultDeckLayout(), dockHeight: 160 }).height).toBe(100)
  })
})
