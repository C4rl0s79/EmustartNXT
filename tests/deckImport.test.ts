import { describe, expect, it } from 'vitest'
import type { PlatformInfo } from '@shared/types'
import { defaultDeckSettings, type DeckCandidate } from '@shared/deck'
import { importPyLinksDeck, pyDeckSettings } from '@shared/deckImport'

// shapes as in a real %LOCALAPPDATA%\PyLinksDeck\layouts.json (schema 4) and EmuStart's platform catalog
const CATALOG: PlatformInfo[] = [
  { es: 'psx', display: 'PlayStation', plat: 'PS1', family: 'console' },
  { es: 'ps2', display: 'PlayStation 2', plat: 'PS2', family: 'console' },
  { es: 'dreamcast', display: 'Dreamcast', plat: 'DC', family: 'console' },
  { es: 'gamecube', display: 'GameCube', plat: 'GCN', family: 'console' },
  { es: 'mame', display: 'MAME', plat: 'MAME', family: 'arcade' },
  { es: 'arcade', display: 'Arcade', plat: 'MAME', family: 'arcade' }
]
const cand = (id: string, label: string, kind: DeckCandidate['kind'] = 'platform', es?: string): DeckCandidate => ({ id, label, kind, count: 5, ...(es ? { es } : {}) })
const CANDIDATES: DeckCandidate[] = [
  cand('pc/steam', 'Steam'),
  cand('pc/gog', 'GOG'),
  cand('pc/shortcut', 'Skróty Steam'),
  cand('console/emu:psx', 'PlayStation', 'platform', 'psx'),
  cand('console/emu:ps2', 'PlayStation 2', 'platform', 'ps2'),
  cand('console/emu:dreamcast', 'Dreamcast', 'platform', 'dreamcast'),
  cand('console/emu:gamecube', 'GameCube', 'platform', 'gamecube'),
  cand('arcade/emu:mame', 'MAME', 'platform', 'mame'),
  cand('arcade/emu:arcade', 'Arcade', 'platform', 'arcade'),
  cand('console/emu:nds', 'Nintendo DS', 'platform', 'nds'),
  cand('col/cat:1', 'Tekken', 'collection')
]
const pyGroup = (gid: string, kind: string, value: string, extra: Record<string, unknown> = {}) => ({ gid, title: value, rule: { kind, value }, cols: 10, aspect: 'portrait', hidden: false, ...extra })
const FILE = {
  schema: 4,
  settings: {
    groups: [
      pyGroup('coll::Tekken', 'collection', 'Tekken', { cols: 7, aspect: 'square', hidden: true }),
      pyGroup('coll::Star Wars', 'collection', 'Star Wars', { hidden: true }),
      pyGroup('plat::PC', 'platform', 'PC'),
      pyGroup('plat::PS1', 'platform', 'PS1'),
      pyGroup('plat::GCN', 'platform', 'GCN', { cols: 14 }),
      pyGroup('plat::NAOMI', 'platform', 'NAOMI', { cols: 4 }),
      pyGroup('plat::MAME', 'platform', 'MAME', { cols: 13 }),
      pyGroup('plat::DC', 'platform', 'DC', { hidden: true })
    ],
    active_gid: 'plat::PS1',
    show_labels: false,
    show_logos: true,
    logo_style: 'Light_Color',
    scroll_speed: 0.3,
    animations: true,
    auto_hide: true,
    opacity: 1,
    screens: {
      '2048x1280@1.25': { label: '2048×1280 ×1.25', dock_width: 1, dock_height: 46, dock_offset: 0, panel_width: 0.94, panel_height: 0.8 },
      '2560x1440@1.5': { label: '2560×1440 ×1.5', dock_width: 1, dock_height: 46, dock_offset: 0, panel_width: 0.94, panel_height: 0.9044540229885057 }
    }
  }
}

const settingsOf = (raw: unknown): Record<string, unknown> => {
  const s = pyDeckSettings(raw)
  if ('error' in s) throw new Error(String(s.error))
  return s
}
const ids = (to: { id: string }[]): string[] => to.map((t) => t.id)

describe('pyDeckSettings', () => {
  it('takes only PyLinksDeck 0.6 settings (schema 4) with tabs', () => {
    expect(pyDeckSettings(FILE)).toBe(FILE.settings)
    expect(pyDeckSettings({ schema: 2, profiles: {} })).toHaveProperty('error')
    expect(pyDeckSettings({ schema: 4, settings: { groups: [] } })).toHaveProperty('error')
    expect(pyDeckSettings({})).toHaveProperty('error')
  })
})

describe('importPyLinksDeck', () => {
  const r = importPyLinksDeck(settingsOf(FILE), { ...defaultDeckSettings(), enabled: true }, CANDIDATES, CATALOG)

  it('maps platform codes through the catalog (every entry with the code), PC to the three PC subgroups, collections by name', () => {
    expect(r.mapped.map((m) => [m.from, ids(m.to)])).toEqual([
      ['Tekken', ['col/cat:1']],
      ['PC', ['pc/steam', 'pc/gog', 'pc/shortcut']],
      ['PS1', ['console/emu:psx']],
      ['GCN', ['console/emu:gamecube']],
      ['MAME', ['arcade/emu:mame', 'arcade/emu:arcade']],
      ['DC', ['console/emu:dreamcast']]
    ])
    expect(r.mapped[2].to).toEqual([{ id: 'console/emu:psx', label: 'PlayStation' }])
    expect(r.skipped).toEqual(['Star Wars', 'NAOMI'])
  })

  it('keeps PyLinksDeck order, visibility, columns and shape; every other subgroup follows hidden', () => {
    expect(r.deck.groups.map((g) => [g.id, g.hidden, g.cols, g.aspect])).toEqual([
      ['col/cat:1', true, 7, 'square'],
      ['pc/steam', false, 10, 'portrait'],
      ['pc/gog', false, 10, 'portrait'],
      ['pc/shortcut', false, 10, 'portrait'],
      ['console/emu:psx', false, 10, 'portrait'],
      ['console/emu:gamecube', false, 14, 'portrait'],
      ['arcade/emu:mame', false, 13, 'portrait'],
      ['arcade/emu:arcade', false, 13, 'portrait'],
      ['console/emu:dreamcast', true, 10, 'portrait'],
      ['console/emu:ps2', true, 8, 'portrait'],
      ['console/emu:nds', true, 8, 'portrait']
    ])
  })

  it('a tab whose targets an earlier tab took is merged into them, not reported as missing', () => {
    const s = { ...FILE.settings, groups: [...FILE.settings.groups, pyGroup('plat::ARCADE', 'platform', 'ARCADE')] }
    const m = importPyLinksDeck(s, defaultDeckSettings(), CANDIDATES, CATALOG)
    expect(m.skipped).not.toContain('ARCADE')
    expect(ids(m.mapped.at(-1)!.to)).toEqual(['arcade/emu:arcade'])
    expect(m.deck.groups.filter((g) => g.id === 'arcade/emu:arcade')).toHaveLength(1)
  })

  it("keeps the player's other tabs — their look and order, also a tab whose subgroup is gone now — hidden", () => {
    const current = {
      ...defaultDeckSettings(),
      groups: [
        { id: 'console/emu:nds', cols: 12, aspect: 'square' as const, hidden: false },
        { id: 'col/cat:gone', cols: 5, aspect: 'portrait' as const, hidden: false }
      ]
    }
    const k = importPyLinksDeck(settingsOf(FILE), current, CANDIDATES, CATALOG)
    const tail = k.deck.groups.slice(-3).map((g) => [g.id, g.hidden, g.cols, g.aspect])
    expect(tail).toEqual([
      ['console/emu:nds', true, 12, 'square'],
      ['col/cat:gone', true, 5, 'portrait'],
      ['console/emu:ps2', true, 8, 'portrait']
    ])
  })

  it('takes the active tab, the options and the per-screen dimensions; keeps Deck switched on', () => {
    expect(r.deck).toMatchObject({ enabled: true, activeGroup: 'console/emu:psx', showLabels: false, showLogos: true, scrollSpeed: 0.3, opacity: 1 })
    expect(r.deck.screens['2560x1440@1.5']).toEqual({ label: '2560×1440 ×1.5', dockWidth: 1, dockHeight: 46, dockOffset: 0, panelWidth: 0.94, panelHeight: 0.9044540229885057 })
    expect(Object.keys(r.deck.screens)).toEqual(['2048x1280@1.25', '2560x1440@1.5'])
  })
})
