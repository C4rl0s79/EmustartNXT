import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Game, IgdbSeries } from '@shared/types'
import { arrangeSeries, seriesLookupKey, seriesOf, setIgdbResolver } from '@shared/series'
import { SeriesService } from '../src/main/series'

// Serie z IGDB osobnym kanałem (zgłoszenie 2026-11-16): okno pobiera je raz, potem dostaje tylko zmiany — bez pełnej
// migawki biblioteki do okien i Decka. Ręczne zmiany gracza idą z preferencjami (nie przez tę usługę).

const g = (id: string, name: string): Game => ({ id, name, sortName: name.toLowerCase(), source: 'steam' }) as unknown as Game

afterEach(() => setIgdbResolver((x) => x.igdbSeries))

describe('źródło serii z IGDB ustawiane przez okno', () => {
  it('zmiana mapy zmienia rozpoznanie bez nowej migawki gier', () => {
    const a = g('a', 'Yakuza 0')
    const b = g('b', 'Like a Dragon: Infinite Wealth')
    expect(seriesOf(b, undefined)?.name).toBe('Like a Dragon')
    const map = new Map<string, IgdbSeries>()
    setIgdbResolver((x) => map.get(seriesLookupKey(x)))
    map.set(seriesLookupKey(a), { name: 'Yakuza', order: 1, release: 1 })
    map.set(seriesLookupKey(b), { name: 'Yakuza', order: 3, release: 3 })
    expect(seriesOf(b, undefined)?.name).toBe('Yakuza') // ten sam obiekt gry — pamięć wyniku uwzględnia nazwę z IGDB
    expect(arrangeSeries([b, a].sort((x, y) => x.sortName.localeCompare(y.sortName)), undefined).map((x) => x.id)).toEqual(['a', 'b'])
  })
})

describe('SeriesService wysyła tylko zmiany', () => {
  const engine = (answer: () => unknown) =>
    ({ state: 'ready', call: async () => answer() }) as unknown as ConstructorParameters<typeof SeriesService>[1]

  it('dodane, zmienione i usunięte — nic, gdy bez zmian', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'lumen-series-'))
    let series: Record<string, unknown> = { 'pc|yakuza 0': { name: 'Yakuza', order_ts: 1, release_ts: 2 } }
    const s = new SeriesService(path.join(dir, 'series.json'), engine(() => ({ ok: true, series, pending: 0 })), () => [])
    const got: Record<string, IgdbSeries | null>[] = []
    s.on('change', (c) => got.push(c))
    await s.sync()
    expect(got).toEqual([{ 'pc|yakuza 0': { name: 'Yakuza', order: 1, release: 2 } }])
    await s.sync()
    expect(got.length).toBe(1) // bez zmian — bez zdarzenia
    series = { 'pc|doom': { name: 'Doom', order_ts: 5, release_ts: 5 } }
    await s.sync()
    expect(got[1]).toEqual({ 'pc|doom': { name: 'Doom', order: 5, release: 5 }, 'pc|yakuza 0': null })
    expect(Object.keys(await s.all())).toEqual(['pc|doom'])
    s.schedule(3_600_000) // zegar następnego pytania nie blokuje końca testu
  })

  it('plik z dysku nie nadpisuje nowszego wyniku z serwera (sync czeka na wczytanie)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'lumen-series-'))
    const file = path.join(dir, 'series.json')
    const old = new SeriesService(file, engine(() => ({ ok: true, series: { 'pc|a': { name: 'Stara', order_ts: 1 } } })), () => [])
    await old.sync()
    old.schedule(3_600_000)
    const s = new SeriesService(file, engine(() => ({ ok: true, series: { 'pc|a': { name: 'Nowa', order_ts: 1 } } })), () => [])
    const sync = s.sync() // przed load() — jak przy szybkim silniku i wolnym dysku
    void s.load()
    await sync
    expect((await s.all())['pc|a'].name).toBe('Nowa')
    s.schedule(3_600_000)
  })
})
