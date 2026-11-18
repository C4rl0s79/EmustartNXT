import { describe, expect, it } from 'vitest'
import type { Game } from '@shared/types'
import { seriesOnScope } from '@shared/series'
import { seriesSummary } from '../src/renderer/src/modals/SeriesEditor'

const g = (id: string, name: string): Game => ({ id, name, sortName: name.toLowerCase(), source: 'gog', installed: true }) as unknown as Game

// zgłoszenie 2026-11-18: „Utwórz serię «Dragon Lance»” dla jednej gry — seria znikała z opcji gry
describe('seriesSummary — seria gracza z jedną grą', () => {
  const lib = [g('cok', 'Champions of Krynn'), g('hotl', 'Heroes of the Lance'), g('dok', 'Death Knights of Krynn')]

  it('nowa seria gracza jest serią od pierwszej gry', () => {
    const prefs = { cok: { name: 'Dragon Lance' } }
    expect(seriesSummary(lib[0], lib, prefs)).toBe('Dragon Lance · 1 z 1')
    expect(seriesOnScope(lib[1], lib, prefs).map((x) => x.name)).toContain('Dragon Lance')
  })

  it('druga gra dołączona do tej serii — obie w niej', () => {
    const prefs = { cok: { name: 'Dragon Lance' }, hotl: { name: 'Dragon Lance' } }
    expect(seriesSummary(lib[0], lib, prefs)).toMatch(/^Dragon Lance · \d z 2$/)
    expect(seriesSummary(lib[1], lib, prefs)).toMatch(/^Dragon Lance · \d z 2$/)
  })

  it('seria rozpoznana z jedną grą — dalej brak', () => {
    expect(seriesSummary(lib[1], lib, {})).toBe('brak — można dołączyć do serii')
  })
})
