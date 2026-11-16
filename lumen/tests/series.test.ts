import { describe, expect, it } from 'vitest'
import type { Game, IgdbSeries } from '@shared/types'
import { arrangeSeries, cleanSeriesPrefs, groupsOnScope, moveInSeries, orderSeries, parseSeries, seriesLookupKey, seriesMembers, seriesOf, seriesOnScope, seriesStoreKey } from '@shared/series'
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

// zgłoszenie 2026-11-16 (8 punktów): seria = kolekcja, franczyza = grupa; seria pod swoją nazwą, bez mieszania
// platform; kolejność po dacie oryginału z IGDB dla każdej gry, która ją ma; przedrostki marki i dopiski wydania
describe('serie wg zgłoszenia 2026-11-16', () => {
  const ig = (name: string, year: number, group?: string): IgdbSeries => ({ name, order: Date.UTC(year, 5) / 1000, release: Date.UTC(year, 5) / 1000, ...(group ? { group } : {}) })
  const gi = (id: string, name: string, igdb?: IgdbSeries, source: Game['source'] = 'gog'): Game =>
    ({ ...g(id, name), source, ...(igdb ? { igdbSeries: igdb } : {}) }) as Game

  it('seria pod swoją nazwą, nie pod pierwszą grą (Ultima przy „Akalabeth” → pod U)', () => {
    const lib = [
      gi('ak', 'Akalabeth: World of Doom', ig('Ultima', 1979)),
      gi('ag', 'Age of Wonders'),
      gi('u4', 'Ultima IV: Quest of the Avatar', ig('Ultima', 1985)),
      gi('ty', 'Tyrian 2000'),
      gi('zz', 'Zork')
    ].sort(byName)
    expect(names(arrangeSeries(lib, {}))).toEqual(['Age of Wonders', 'Tyrian 2000', 'Akalabeth: World of Doom', 'Ultima IV: Quest of the Avatar', 'Zork'])
  })

  it('kolekcja to seria, franczyza to grupa (Dungeons & Dragons nie łączy Baldur’s Gate z Eye of the Beholder)', () => {
    const lib = [
      gi('b1', "Baldur's Gate", ig("Baldur's Gate", 1998, 'Dungeons & Dragons')),
      gi('b2', "Baldur's Gate II", ig("Baldur's Gate", 2000, 'Dungeons & Dragons')),
      gi('e1', 'Eye of the Beholder', ig('Eye of the Beholder', 1991, 'Dungeons & Dragons')),
      gi('e2', 'Eye of the Beholder II', ig('Eye of the Beholder', 1991, 'Dungeons & Dragons')),
      gi('hl', 'Heroes of the Lance', { name: '', order: Date.UTC(1988, 1) / 1000, release: 0, group: 'Dungeons & Dragons' })
    ]
    expect(seriesOf(lib[0], {})!.key).not.toBe(seriesOf(lib[2], {})!.key)
    expect(seriesOf(lib[2], {})!.group).toBe('Dungeons & Dragons')
    expect(seriesMembers(lib[4], lib, {}).length).toBe(1)          // sama franczyza — seria z tytułu, bez pary
    expect(groupsOnScope(lib[0], lib, {})).toEqual(['Dungeons & Dragons'])
    expect(seriesOnScope(lib[0], lib, {}).map((x) => x.name)).toEqual(["Baldur's Gate", 'Eye of the Beholder'])
  })

  it('seria nie miesza platform: Steam osobno, GOG osobno', () => {
    const a = gi('s', 'Mortal Kombat X', ig('Mortal Kombat', 2015), 'steam')
    const b = gi('o', 'Mortal Kombat 3', ig('Mortal Kombat', 1995), 'gog')
    expect(seriesOf(a, {})!.key).not.toBe(seriesOf(b, {})!.key)
    expect(seriesMembers(a, [a, b], {}).map((x) => x.id)).toEqual(['s'])
  })

  it('przedrostek marki i dopiski wydania (Sid Meier’s Pirates! = Pirates! Gold; Ultima VIII Gold Edition → 8)', () => {
    expect(seriesOf(gi('a', "Sid Meier's Pirates!"), {})!.key).toBe(seriesOf(gi('b', 'Pirates! Gold'), {})!.key)
    expect(parseSeries('Ultima VIII Gold Edition')).toEqual({ base: 'Ultima', num: 8 })
    expect(parseSeries('Tomb Raider I-III Remastered')).toEqual({ base: 'Tomb Raider', num: 1 })
    expect(parseSeries('Fallout 2 Classic')).toEqual({ base: 'Fallout', num: 2 })
    expect(seriesOf(gi('c', 'Heroes of Might & Magic V'), {})!.key).toBe(seriesOf(gi('d', 'Heroes of Might and Magic III'), {})!.key)
    expect(seriesOf(gi('c', 'Heroes of Might & Magic V'), {})!.key).not.toBe(seriesOf(gi('e', 'Might and Magic VI'), {})!.key)
  })

  it('kolejność: data z IGDB dla gier, które ją mają; reszta po numerze między nimi; w obrębie roku — numer', () => {
    const hm = (id: string, n: string, y?: number) => gi(id, n, y ? ig('Heroes of Might and Magic', y) : undefined)
    const ordered = orderSeries([hm('5', 'Heroes of Might and Magic V', 2006), hm('3', 'Heroes of Might and Magic 3: Complete'), hm('4', 'Heroes of Might and Magic IV', 2002)], {})
    expect(ordered.map((x) => x.id)).toEqual(['3', '4', '5'])
    // EoB II z błędną (wcześniejszą) pełną datą w tym samym roku — I przed II
    const e1 = gi('e1', 'Eye of the Beholder', { name: 'Eye of the Beholder', order: Date.UTC(1991, 11) / 1000, release: 0 })
    const e2 = gi('e2', 'Eye of the Beholder II: The Legend of Darkmoon', { name: 'Eye of the Beholder', order: Date.UTC(1991, 1) / 1000, release: 0 })
    expect(orderSeries([e2, e1], {}).map((x) => x.id)).toEqual(['e1', 'e2'])
    const b = (id: string, n: string, y: number) => gi(id, n, ig('BioShock', y))
    expect(names(orderSeries([b('i', 'BioShock Infinite', 2013), b('2', 'BioShock 2', 2010), b('1', 'BioShock', 2007)], {}))).toEqual(['BioShock', 'BioShock 2', 'BioShock Infinite'])
  })

  it('nazwa kolekcji z małych liter — zapisana jak w tytule', () => {
    expect(seriesOf(gi('d', 'Deus Ex: Mankind Divided', ig('deus ex', 2016)), {})!.name).toBe('Deus Ex')
  })

  it('Fallout bez zmian: jedna seria w kolejności wydania', () => {
    const f = (id: string, n: string, y: number) => gi(id, n, ig('Fallout', y, 'Fallout'))
    const lib = [f('4', 'Fallout 4', 2015), f('1', 'Fallout', 1997), f('nv', 'Fallout: New Vegas', 2010), f('2', 'Fallout 2', 1998), f('3', 'Fallout 3', 2008)].sort(byName)
    expect(names(arrangeSeries(lib, {}))).toEqual(['Fallout', 'Fallout 2', 'Fallout 3', 'Fallout: New Vegas', 'Fallout 4'])
  })

  it('klucz sklepu: Steam po appId, GOG po productId, reszta bez niego', () => {
    expect(seriesStoreKey({ ...g('x', 'Tomb Raider'), source: 'steam', appId: 203160 } as Game)).toBe('steam|203160')
    expect(seriesStoreKey({ ...g('y', 'Tomb Raider'), source: 'gog', gog: { productId: '1207' } } as unknown as Game)).toBe('gog|1207')
    expect(seriesStoreKey({ ...g('z', 'Doom'), source: 'emustart' } as Game)).toBeUndefined()
  })
})
