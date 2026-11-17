import { describe, expect, it } from 'vitest'
import type { Game } from '@shared/types'
import { letterJump, letterOf } from '../src/renderer/src/tv/letters'
import { arrangeSeries, placedSeriesKeys } from '@shared/series'
import { compareText } from '@shared/libraryNav'

// lista jak w Lumenie: po kluczu sortowania bez przedimka („The Witcher” → „witcher”)
const g = (name: string): Game =>
  ({ id: name, name, sortName: name.toLowerCase().replace(/^(the|a|an)\s+/, '') }) as unknown as Game
const list = ['Alan Wake', 'The Adventures of Lomax', 'Amnesia', 'A Plague Tale', 'Arx Fatalis', 'Baldur’s Gate', 'The Banner Saga', 'Braid', 'Cyberpunk 2077']
  .map(g)
  .sort((a, b) => a.sortName.localeCompare(b.sortName, 'pl'))

describe('skok po literach (tryb TV)', () => {
  it('litera z klucza sortowania, nie z tytułu', () => {
    expect(letterOf(g('The Witcher 3'))).toBe('W')
    expect(letterOf(g('A Plague Tale'))).toBe('P')
    expect(letterOf(g('2064: Read Only Memories'))).toBe('#')
  })

  it('jedno naciśnięcie: z A na pierwszą grę na B, potem na C', () => {
    const i = list.findIndex((x) => x.name === 'Alan Wake')
    const b = letterJump(list, i, 1)
    expect(list[b].sortName.charAt(0)).toBe('b')
    expect(list[b - 1].sortName.charAt(0)).not.toBe('b')
    expect(list[letterJump(list, b, 1)].name).toBe('Cyberpunk 2077')
  })

  it('wstecz: na pierwszą grę poprzedniej litery', () => {
    const c = list.findIndex((x) => x.name === 'Cyberpunk 2077')
    const b = letterJump(list, c, -1)
    expect(list[b].sortName.charAt(0)).toBe('b')
    expect(b === 0 || list[b - 1].sortName.charAt(0) !== 'b').toBe(true)
  })

  it('krańce listy', () => {
    expect(letterJump(list, list.length - 1, 1)).toBe(list.length - 1)
    expect(letterJump(list, 0, -1)).toBe(0)
    expect(letterJump([], 0, 1)).toBe(0)
  })
})

describe('skok po literach — serie (Amiga WHDLoad, 2026-11-17)', () => {
  // seria Dizzy (gracz przypisał gry) stoi razem pod „Dizzy”, przy D — tytuły na B, F, M, T
  const dizzy = { name: 'Dizzy' }
  const titles = ['Alien Breed', 'Bubble Dizzy', 'Cannon Fodder', 'Dizzy', 'Dungeon Master', 'Fantasy World Dizzy', 'Flood', 'Magicland Dizzy', 'Moonstone', 'Treasure Island Dizzy', 'Turrican']
  const games = titles.map(g).sort((a, b) => compareText(a.sortName, b.sortName))
  const prefs = { 'Bubble Dizzy': dizzy, 'Fantasy World Dizzy': dizzy, 'Magicland Dizzy': dizzy, 'Treasure Island Dizzy': dizzy, Dizzy: dizzy }
  const list = arrangeSeries(games, prefs)
  const keys = placedSeriesKeys(list)
  const keyOf = (x: Game): string | undefined => keys?.get(x.id)
  const at = (name: string): number => list.findIndex((x) => x.name === name)
  const jumps = (from: string, dir: 1 | -1, n: number): string[] => {
    const out: string[] = []
    let i = at(from)
    for (let k = 0; k < n; k++) out.push(list[(i = letterJump(list, i, dir, keyOf))].name)
    return out
  }

  const dizzyAt = list.map((x, i) => (x.name.includes('Dizzy') ? i : -1)).filter((i) => i >= 0)
  const firstD = list[Math.min(dizzyAt[0], at('Dungeon Master'))].name

  it('blok serii stoi razem przy D, każda gra bloku ma klucz serii (założenie testu)', () => {
    expect(dizzyAt).toEqual(dizzyAt.map((_, k) => dizzyAt[0] + k))
    for (const i of dizzyAt) expect(keyOf(list[i])?.charAt(0)).toBe('d')
    expect(list[dizzyAt[0] - 1].name).toBe('Cannon Fodder')
  })

  it('naprzód: A → C → D (pierwsza gra na D) → F → M → T, bez zatrzymań w bloku serii', () => {
    expect(jumps('Alien Breed', 1, 5)).toEqual(['Cannon Fodder', firstD, 'Flood', 'Moonstone', 'Turrican'])
  })

  it('wstecz: T → M → F → D (pierwsza gra na D) → C', () => {
    expect(jumps('Turrican', -1, 4)).toEqual(['Moonstone', 'Flood', firstD, 'Cannon Fodder'])
  })

  it('bez kluczy serii — dawne zachowanie (zatrzymanie w bloku) — dowód, że test łapie błąd', () => {
    let i = at('Cannon Fodder')
    i = letterJump(list, i, 1)
    i = letterJump(list, i, 1)
    expect(dizzyAt).toContain(i) // stary kod: drugi skok zatrzymuje się w środku bloku serii
  })

  it('litera z akcentem spoza polskiego alfabetu — jak bez akcentu; polskie litery osobno', () => {
    expect(letterOf(g('Élite'))).toBe('E')
    expect(letterOf(g('Über Racer'))).toBe('U')
    expect(letterOf(g('Łowcy'))).toBe('Ł')
    expect(letterOf(g('Ósemka'))).toBe('Ó')
    expect(letterOf(g('Ørsted'))).toBe('O')
    expect(letterOf(g('Æon Flux'))).toBe('A')
  })

  it('klucze tylko dla listy z arrangeSeries (np. „Ostatnio grane” — brak, litera z tytułu)', () => {
    expect(placedSeriesKeys([...list])).toBeUndefined()
    expect(placedSeriesKeys(arrangeSeries(titles.slice(0, 2).map(g), {}))?.size).toBe(0)
  })
})
