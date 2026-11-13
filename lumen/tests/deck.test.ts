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
  onThisPc,
  setDeckLayout,
  moveDeckGroup,
  screenKey,
  syncGroups,
  visibleGroups,
  type DeckCandidate,
  type DeckGroup,
  type DeckSettings
} from '@shared/deck'

const games = (n: number): Game[] => Array.from({ length: n }, (_, i) => ({ id: `g${i}`, installed: true }) as Game)
const g = (id: string, extra: Partial<DeckGroup> = {}): DeckGroup => ({ id, cols: 8, aspect: 'portrait', hidden: false, ...extra })
const c = (id: string, count: number, kind: DeckCandidate['kind'] = 'platform', label = id): DeckCandidate => ({ id, label, kind, count })

describe('defaults (PyLinksDeck profiles.py)', () => {
  it('starts switched off; the dock spans 95 % of the screen, the games panel 94 %', () => {
    const s = defaultDeckSettings()
    expect(s.enabled).toBe(false)
    expect(s).toMatchObject({ showLabels: true, showLogos: true, scrollSpeed: 0.7, animations: true, autoHide: true, opacity: 0.96 })
    expect(defaultDeckLayout()).toEqual({ label: '', dockWidth: 0.95, dockHeight: 46, dockOffset: 0, panelWidth: 0.94, panelHeight: 0.8 })
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
  it('builds the key from size and scale only, with a readable label', () => {
    // the label: the real resolution and the scaling (a 4K monitor at 150 % is 2560×1440 logical px)
    expect(screenKey(2560, 1440, 1.5, { width: 3840, height: 2160 })).toEqual({ key: '2560x1440@1.5', label: '3840×2160, skalowanie 150%' })
    expect(screenKey(1920, 1080, 1, { width: 1920, height: 1080 })).toEqual({ key: '1920x1080@1', label: '1920×1080' })
    expect(screenKey(2048, 1280, 1.25, { width: 2560, height: 1600 })).toEqual({ key: '2048x1280@1.25', label: '2560×1600, skalowanie 125%' })
    // Windows rounds the logical size (2560×1600 at 150 % → 1707×1067): the device size from Windows wins
    expect(screenKey(1707, 1067, 1.5, { width: 2560, height: 1600 }).label).toBe('2560×1600, skalowanie 150%')
  })

  it('rounds the scale to 2 decimals (no float noise in the key)', () => {
    expect(screenKey(2560, 1440, 1.2500000001, { width: 3200, height: 1800 }).key).toBe('2560x1440@1.25')
  })

  it('rounds a fractional logical size, so the key survives validation on load', () => {
    const { key } = screenKey(2560 / 1.5, 1600 / 1.5, 1.5, { width: 2560, height: 1600 })
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

describe('onThisPc — Deck shows the games on this PC', () => {
  it('installed Steam / GOG / shortcut games and downloaded EmuStart games count; the rest does not', () => {
    expect(onThisPc({ installed: true } as Game)).toBe(true)
    expect(onThisPc({ installed: false } as Game)).toBe(false)
    expect(onThisPc({ installed: false, emu: { cached: true } } as Game)).toBe(true)
    expect(onThisPc({ installed: true, emu: { cached: false } } as Game)).toBe(false)
  })

  it('a tab counts only the games on this PC (a platform with none has no tab)', () => {
    const nav: NavGroup[] = [{ id: 'console', label: 'Konsole', games: [], subs: [{ id: 'console/emu:ps2', label: 'PS2', es: 'ps2', games: [{ id: 'a', installed: false, emu: { cached: true } } as Game, { id: 'b', installed: false, emu: { cached: false } } as Game] }] }]
    expect(deckCandidates(nav)[0].count).toBe(1)
    // a platform with only games not on this PC: no new tab, and a stored one is not shown
    const none = deckCandidates([{ ...nav[0], subs: [{ ...nav[0].subs[0], games: [{ id: 'c', installed: false, emu: { cached: false } } as Game] }] }])
    expect(none[0].count).toBe(0)
    expect(syncGroups([], none)).toEqual([])
    expect(visibleGroups({ ...defaultDeckSettings(), groups: [g('console/emu:ps2')] }, none)).toEqual([])
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

  it('never adds what the stored settings would drop (no endless re-sync)', () => {
    const many = Array.from({ length: 310 }, (_, i) => c(`console/emu:p${i}`, 1))
    const out = syncGroups([], [...many, c('bez-ukośnika', 5)])
    expect(out).toHaveLength(300)
    expect(syncGroups(out, many)).toBe(out)
    expect(cleanDeckSettings({ groups: out }).groups).toHaveLength(300)
  })

  it('keeps a chosen tab that is not stored yet', () => {
    expect(cleanDeckSettings({ groups: [], activeGroup: 'col/cat:new' }).activeGroup).toBe('col/cat:new')
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

  it('drops invalid and duplicate tabs, clamps values, and resets an invalid active tab', () => {
    const out = cleanDeckSettings({
      enabled: 'yes',
      groups: [{ id: 'console/emu:ps2', cols: 99, aspect: 'wide' }, { id: 'console/emu:ps2' }, { id: 'bez-ukośnika' }, { id: 5 }, null],
      activeGroup: 'bez-ukośnika',
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
    expect(dockRect(area, defaultDeckLayout())).toEqual({ x: 48, y: 0, width: 1824, height: 46 })
  })
  it('follows the work area (taskbar at the top, second screen left of the primary)', () => {
    expect(dockRect({ x: -2560, y: 40, width: 2560, height: 1400 }, { ...defaultDeckLayout(), dockWidth: 1, dockOffset: 12 })).toEqual({ x: -2560, y: 52, width: 2560, height: 46 })
  })
  it('keeps at least 240 × 28 px, never wider than the screen, and ignores a negative offset', () => {
    expect(dockRect({ x: 0, y: 0, width: 200, height: 600 }, { ...defaultDeckLayout(), dockWidth: 0.1, dockHeight: 10, dockOffset: -50 })).toEqual({ x: 0, y: 0, width: 200, height: 28 })
    expect(dockRect(area, { ...defaultDeckLayout(), dockWidth: 0.1 }).width).toBe(240)
  })
  it('stays inside the work area: a layout from a taller screen never puts the dock off-screen', () => {
    expect(dockRect(area, { ...defaultDeckLayout(), dockOffset: 1200 })).toEqual({ x: 48, y: 994, width: 1824, height: 46 })
    expect(dockRect({ x: 0, y: 0, width: 800, height: 100 }, { ...defaultDeckLayout(), dockHeight: 160 }).height).toBe(100)
  })
})

describe('moveDeckGroup', () => {
  const gs = [g('a/1'), g('a/2'), g('a/3')]
  it('hides / shows one tab and moves it by one place', () => {
    expect(moveDeckGroup(gs, { id: 'a/2', hidden: true })[1].hidden).toBe(true)
    // kształt kafli z menu Decka (jak w PyLinksDeck): kwadrat / okładka 2:3; bez zmiany — ta sama tablica
    expect(moveDeckGroup(gs, { id: 'a/2', aspect: 'square' })[1].aspect).toBe('square')
    expect(moveDeckGroup(gs, { id: 'a/2', aspect: gs[1].aspect })).toBe(gs)
    expect(moveDeckGroup(gs, { id: 'a/3', move: -1 }).map((x) => x.id)).toEqual(['a/1', 'a/3', 'a/2'])
  })
  it('returns the same array when nothing changes', () => {
    expect(moveDeckGroup(gs, { id: 'a/1', move: -1 })).toBe(gs)
    expect(moveDeckGroup(gs, { id: 'a/3', move: 1 })).toBe(gs)
    expect(moveDeckGroup(gs, { id: 'x/9', hidden: true })).toBe(gs)
    expect(moveDeckGroup(gs, { id: 'a/1', hidden: false })).toBe(gs)
  })
})

describe('setDeckLayout', () => {
  const base = { ...defaultDeckSettings(), screens: { '1920x1080@1': { ...defaultDeckLayout('1920×1080'), dockWidth: 0.8 }, '1280x720@1': defaultDeckLayout('1280×720') } }
  it('steps one width of one screen, from its stored or default values', () => {
    const out = setDeckLayout(base, { key: '2560x1440@1', label: '2560×1440', field: 'panelWidth', delta: -0.01 })
    expect(out['1920x1080@1']).toBe(base.screens['1920x1080@1'])
    expect(out['2560x1440@1']).toEqual({ ...defaultDeckLayout('2560×1440'), panelWidth: 0.93 })
  })
  it('steps add up (no stale value) and stay in the allowed range', () => {
    let s: DeckSettings = base
    for (let i = 0; i < 3; i++) s = { ...s, screens: setDeckLayout(s, { key: '1920x1080@1', label: '1920×1080', field: 'dockWidth', delta: 0.01 }) }
    expect(s.screens['1920x1080@1'].dockWidth).toBe(0.83)
    expect(setDeckLayout(base, { key: '1920x1080@1', label: '1920×1080', field: 'dockWidth', delta: 0.5 })['1920x1080@1'].dockWidth).toBe(1)
    expect(setDeckLayout(base, { key: '1920x1080@1', label: '1920×1080', field: 'dockWidth', delta: -0.9 })['1920x1080@1'].dockWidth).toBe(0.3)
  })
  it('moves the edited screen to the end (the newest are kept)', () => {
    expect(Object.keys(setDeckLayout(base, { key: '1920x1080@1', label: '1920×1080', field: 'dockWidth', delta: 0.01 }))).toEqual(['1280x720@1', '1920x1080@1'])
  })
})
