import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { detailsOf } from '../src/main/xbox/catalog'
import { pauseAfter429, WikipediaDescriptions, wikiCandidates } from '../src/main/details/wikipedia'
import { HttpError } from '../src/main/net'

// etap 23: opisy dla każdej gry — katalog Microsoft (Xbox) i Wikipedia jako ostatnie źródło

const json = (body: unknown): Response => new Response(JSON.stringify(body))
const asFetcher = (fn: (url: string) => Promise<Response>): never => fn as never

describe('opis gry Xbox z katalogu Microsoft', () => {
  it('bierze opis, producenta, wydawcę, gatunki i datę; pierwszy język z treścią', () => {
    const parsed = detailsOf({
      ProductId: '9MTHD5L1ZQK1',
      LocalizedProperties: [
        { ProductTitle: 'FINAL FANTASY V', ProductDescription: '', ShortDescription: 'Krótko', DeveloperName: 'SQUARE ENIX' },
        { ProductTitle: 'FINAL FANTASY V', ProductDescription: 'Long description', PublisherName: 'SQUARE ENIX' }
      ],
      Properties: { Category: 'Role playing', Categories: ['Role playing', 'Adventure'] },
      MarketProperties: [{ OriginalReleaseDate: '2021-11-10T00:00:00.0000000Z' }]
    })
    expect(parsed).toEqual({
      description: 'Long description',
      short: 'Krótko',
      developer: 'SQUARE ENIX',
      publisher: 'SQUARE ENIX',
      genres: ['Role playing', 'Adventure'],
      release: '2021-11-10'
    })
  })
  it('„brak daty” Microsoftu (1601) nie jest datą premiery; puste pola nie trafiają do wyniku', () => {
    expect(detailsOf({ MarketProperties: [{ OriginalReleaseDate: '1601-01-01T00:00:00Z' }] })).toEqual({})
  })
})

describe('Wikipedia', () => {
  let dir = ''
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = ''
  })
  const fresh = (fetcher: never): WikipediaDescriptions => {
    dir = mkdtempSync(path.join(tmpdir(), 'lumen-wiki-'))
    return new WikipediaDescriptions(path.join(dir, 'wiki.json'), fetcher)
  }

  it('dopasowanie tytułu: dopisek w nawiasie pomijany, te same numery części', () => {
    expect(wikiCandidates('Final Fantasy V', [{ title: 'Final Fantasy V (gra komputerowa)' }, { title: 'Final Fantasy' }, { title: 'Dragon Quest V' }])).toEqual([
      'Final Fantasy V (gra komputerowa)'
    ])
  })

  it('najpierw polska, bez artykułu — angielska; strona ujednoznaczniająca pomijana; wynik zapisany', async () => {
    const asked: string[] = []
    const fetcher = asFetcher(async (url) => {
      asked.push(url)
      if (url.includes('/w/api.php')) return json({ query: { search: [{ title: 'Final Fantasy V' }] } })
      if (url.includes('pl.wikipedia.org')) return json({ type: 'disambiguation', extract: 'Final Fantasy V może oznaczać' })
      return json({ type: 'standard', extract: 'Final Fantasy V is a 1992 role-playing video game.' })
    })
    const wiki = fresh(fetcher)
    const answer = await wiki.summary('FINAL FANTASY V™')
    expect(answer).toMatchObject({ state: 'hit', hit: { lang: 'en', title: 'Final Fantasy V' } })
    const count = asked.length
    // drugi raz — z zapisu, bez sieci; także w nowym obiekcie (z dysku)
    expect(await wiki.summary('Final Fantasy V')).toEqual(answer)
    expect(await new WikipediaDescriptions(path.join(dir, 'wiki.json'), fetcher).summary('Final Fantasy V')).toEqual(answer)
    expect(asked.length).toBe(count)
    // force — z sieci mimo zapisu
    await wiki.summary('Final Fantasy V', { force: true })
    expect(asked.length).toBeGreaterThan(count)
  })

  it('brak sieci to „nie sprawdzone”, nie „brak artykułu” — i nie jest zapisywany', async () => {
    let online = false
    const wiki = fresh(
      asFetcher(async (url) => {
        if (!online) throw new Error('offline')
        return json(url.includes('api.php') ? { query: { search: [{ title: 'Halo Infinite' }] } } : { extract: 'Halo Infinite – gra.' })
      })
    )
    expect(await wiki.summary('Halo Infinite')).toEqual({ state: 'unknown' })
    online = true
    expect(await wiki.summary('Halo Infinite')).toMatchObject({ state: 'hit', hit: { text: 'Halo Infinite – gra.' } })
  })

  it('po odmowie 429 przerwa: bez kolejnych pytań, wynik „nie sprawdzone”', async () => {
    let calls = 0
    const wiki = fresh(
      asFetcher(async () => {
        calls++
        throw new HttpError(429, 'HTTP 429', Number.NaN)
      })
    )
    expect(await wiki.summary('Halo Infinite')).toEqual({ state: 'unknown' })
    expect(await wiki.summary('Forza Horizon 5')).toEqual({ state: 'unknown' })
    expect(calls).toBe(1)
  })

  it('nieczytelny Retry-After nie wyłącza przerwy (2 min), długi — najwyżej 30 min', () => {
    expect(pauseAfter429(Number.NaN)).toBe(120_000)
    expect(pauseAfter429(undefined)).toBe(120_000)
    expect(pauseAfter429(3_600_000)).toBe(1_800_000)
  })

  it('wolna odpowiedź: po `waitMs` „nie sprawdzone”, szukanie kończy się w tle i zapisuje wynik', async () => {
    const wiki = fresh(
      asFetcher(async (url) => {
        await new Promise((done) => setTimeout(done, 60))
        return json(url.includes('api.php') ? { query: { search: [{ title: 'Grounded' }] } } : { extract: 'Grounded – gra.' })
      })
    )
    expect(await wiki.summary('Grounded', { waitMs: 10 })).toEqual({ state: 'unknown' })
    await new Promise((done) => setTimeout(done, 300))
    expect(await wiki.summary('Grounded', { waitMs: 10 })).toMatchObject({ state: 'hit' })
  })

  it('clear() zapomina zapisane wyniki (czyszczenie pamięci podręcznej)', async () => {
    let calls = 0
    const wiki = fresh(
      asFetcher(async () => {
        calls++
        return json({ query: { search: [] } })
      })
    )
    expect(await wiki.summary('Nieznana Gra')).toEqual({ state: 'miss' })
    const count = calls
    wiki.clear()
    await wiki.summary('Nieznana Gra')
    expect(calls).toBeGreaterThan(count)
  })
})
