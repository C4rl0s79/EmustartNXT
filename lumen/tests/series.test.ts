import { describe, expect, it } from 'vitest'
import type { Game } from '@shared/types'
import { arrangeSeries, cleanSeriesPrefs, moveInSeries, parseSeries, seriesLookupKey, seriesMembers, seriesOf } from '@shared/series'
import { compareText } from '@shared/libraryNav'
import { panelHeightFraction, setDeckPanelHeight, defaultDeckSettings } from '@shared/deck'

const g = (id: string, name: string, year?: string): Game =>
  ({ id, name, sortName: name.toLowerCase(), source: 'gog', installed: true, ...(year ? { facts: { year } } : {}) }) as unknown as Game
const byName = (a: Game, b: Game): number => compareText(a.sortName, b.sortName)
const names = (l: Game[]): string[] => l.map((x) => x.name)

describe('parseSeries', () => {
  it('base and part number from titles', () => {
    expect(parseSeries('Wing Commander')).toEqual({ base: 'Wing Commander', num: 1 })
    expect(parseSeries('Wing Commander III: Heart of the Tiger')).toEqual({ base: 'Wing Commander', num: 3 })
    expect(parseSeries('Wing Commander: Privateer')).toEqual({ base: 'Wing Commander' })
    expect(parseSeries('The Witcher 3: Wild Hunt - Game of the Year Edition')).toEqual({ base: 'The Witcher', num: 3 })
    expect(parseSeries('Half-Life 2: Episode One')).toEqual({ base: 'Half-Life', num: 2 })
    expect(parseSeries('Tomb Raider II (1997)')).toEqual({ base: 'Tomb Raider', num: 2 })
    expect(parseSeries('Strike Commander™')).toEqual({ base: 'Strike Commander', num: 1 })
  })
})

describe('arrangeSeries', () => {
  const lib = [
    g('a', 'Privateer'),
    g('b', 'Strike Commander'),
    g('c', 'Wing Commander III: Heart of the Tiger'),
    g('d', 'Wing Commander'),
    g('e', 'Wing Commander II'),
    g('f', 'Abuse')
  ].sort(byName)

  it('a series stands together where its first game is, by part number', () => {
    expect(names(arrangeSeries(lib, {}))).toEqual(['Abuse', 'Privateer', 'Strike Commander', 'Wing Commander', 'Wing Commander II', 'Wing Commander III: Heart of the Tiger'])
  })

  it('a game the player joined moves to its series; release year orders when every game has one', () => {
    const withYears = [g('a', 'Privateer', '1993'), g('d', 'Wing Commander', '1990'), g('e', 'Wing Commander II', '1991'), g('c', 'Wing Commander III', '1994'), g('f', 'Abuse', '1996')].sort(byName)
    const out = arrangeSeries(withYears, { a: { name: 'Wing Commander' } })
    expect(names(out)).toEqual(['Abuse', 'Wing Commander', 'Wing Commander II', 'Privateer', 'Wing Commander III'])
  })

  it('"not in a series" and the player\'s order win', () => {
    // „Wing Commander II” poza serią: zostaje na swoim miejscu po tytule, seria (I, III) stoi w miejscu pierwszej gry
    expect(names(arrangeSeries(lib, { e: { none: true } }))).toEqual(['Abuse', 'Privateer', 'Strike Commander', 'Wing Commander', 'Wing Commander III: Heart of the Tiger', 'Wing Commander II'])
    const members = seriesMembers(lib.find((x) => x.id === 'e')!, lib, {})
    const moved = moveInSeries(members, 'c', -1, {})!
    expect(names(arrangeSeries(lib, moved)).slice(3)).toEqual(['Wing Commander', 'Wing Commander III: Heart of the Tiger', 'Wing Commander II'])
  })

  it('a list without series is returned as it was (the same array)', () => {
    const l = [g('x', 'Abuse'), g('y', 'Doom')]
    expect(arrangeSeries(l, {})).toBe(l)
  })

  it('one-letter bases are not series', () => {
    expect(seriesOf(g('x', 'X 2'), {})).toBeUndefined()
  })
})

describe('series prefs from the file', () => {
  it('keeps only valid choices', () => {
    expect(cleanSeriesPrefs({ a: { name: ' WC ', order: 2.4 }, b: { none: true }, c: { foo: 1 }, d: 'x' })).toEqual({ a: { name: 'WC', order: 2 }, b: { none: true } })
  })
})

describe('Deck panel height dragged', () => {
  it('px → fraction of the work area, within range', () => {
    expect(panelHeightFraction(540, 1080)).toBe(0.5)
    expect(panelHeightFraction(10, 1080)).toBe(0.1)
    expect(panelHeightFraction(5000, 1080)).toBe(1)
  })
  it('stored for that screen only', () => {
    const s = { ...defaultDeckSettings(), screens: { '1920x1080@1': { label: 'a', dockWidth: 0.9, dockHeight: 46, dockOffset: 0, panelWidth: 0.9, panelHeight: 0.8 } } }
    const out = setDeckPanelHeight(s, '2560x1440@1', 'b', 0.5)
    expect(out['1920x1080@1'].panelHeight).toBe(0.8)
    expect(out['2560x1440@1'].panelHeight).toBe(0.5)
  })
})

describe('serie z IGDB (serwer EmuStart, Game.igdbSeries)', () => {
  const ig = (id: string, name: string, series: string, order: number, release = order): Game =>
    ({ ...g(id, name), igdbSeries: { name: series, order, release } }) as Game
  const y0 = ig('a', 'Yakuza 0', 'Yakuza', 1_134_000_000, 1_420_000_000) // prequel: data serii jak u IGDB
  const kiwami = ig('b', 'Yakuza Kiwami', 'Yakuza', 1_134_000_000, 1_453_000_000) // remake: data oryginału
  const lad = ig('c', 'Like a Dragon: Infinite Wealth', 'Yakuza', 1_706_000_000)
  const other = g('d', 'Judgment')

  it('jedna seria mimo różnych tytułów — w miejscu pierwszej gry, po dacie oryginału', () => {
    const list = arrangeSeries([lad, other, kiwami, y0].sort(byName), undefined)
    expect(names(list)).toEqual(['Judgment', 'Yakuza 0', 'Yakuza Kiwami', 'Like a Dragon: Infinite Wealth'])
    expect(seriesOf(lad, undefined)?.name).toBe('Yakuza')
  })

  it('wybór gracza wygrywa z IGDB', () => {
    expect(seriesOf(lad, { c: { name: 'Like a Dragon' } })?.name).toBe('Like a Dragon')
    expect(seriesOf(lad, { c: { none: true } })).toBeUndefined()
    const moved = arrangeSeries([y0, kiwami, lad].sort(byName), { c: { order: 1 } })
    expect(names(moved)[0]).toBe('Like a Dragon: Infinite Wealth')
  })

  it('IGDB: gra bez serii nie jest zgadywana z tytułu (chyba że gracz nada nazwę)', () => {
    const solo = { ...g('s', 'Doom 3'), igdbSeries: { name: '', order: 0, release: 0 } } as Game
    expect(seriesOf(solo, undefined)).toBeUndefined()
    expect(seriesOf(solo, { s: { name: 'Doom' } })?.name).toBe('Doom')
    expect(seriesOf(g('t', 'Doom 3'), undefined)?.name).toBe('Doom')        // bez wyniku IGDB — z tytułu
  })

  it('klucz jak na serwerze (emustart/igdbseries.key_of)', () => {
    expect(seriesLookupKey(g('x', 'Cyberpunk  2077'))).toBe('pc|cyberpunk 2077')
    const emu = { ...g('y', 'Super Metroid'), source: 'emustart', emu: { es: 'snes' } } as unknown as Game
    expect(seriesLookupKey(emu)).toBe('snes|super metroid')
  })
})
