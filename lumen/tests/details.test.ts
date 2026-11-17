import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { detailsOf } from '../src/main/xbox/catalog'
import { WikipediaDescriptions, wikiCandidates } from '../src/main/details/wikipedia'

// etap 23: opisy dla każdej gry — katalog Microsoft (Xbox) i Wikipedia jako ostatnie źródło

describe('opis gry Xbox z katalogu Microsoft', () => {
  it('bierze opis, producenta, wydawcę, gatunki i datę; pierwszy język z treścią', () => {
    const d = detailsOf({
      ProductId: '9MTHD5L1ZQK1',
      LocalizedProperties: [
        { ProductTitle: 'FINAL FANTASY V', ProductDescription: '', ShortDescription: 'Krótko', DeveloperName: 'SQUARE ENIX' },
        { ProductTitle: 'FINAL FANTASY V', ProductDescription: 'Long description', PublisherName: 'SQUARE ENIX' }
      ],
      Properties: { Category: 'Role playing', Categories: ['Role playing', 'Adventure'] },
      MarketProperties: [{ OriginalReleaseDate: '2021-11-10T00:00:00.0000000Z' }]
    })
    expect(d).toEqual({
      description: 'Long description',
      short: 'Krótko',
      developer: 'SQUARE ENIX',
      publisher: 'SQUARE ENIX',
      genres: ['Role playing', 'Adventure'],
      release: '2021-11-10'
    })
  })
  it('„brak daty” Microsoftu (1601) nie jest datą premiery', () => {
    expect(detailsOf({ MarketProperties: [{ OriginalReleaseDate: '1601-01-01T00:00:00Z' }] }).release).toBeUndefined()
  })
})

describe('Wikipedia', () => {
  let dir = ''
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }))

  it('dopasowanie tytułu jak na serwerze EmuStart (dopisek w nawiasie pomijany, podobieństwo ≥ 0.75)', () => {
    expect(wikiCandidates('Final Fantasy V', [{ title: 'Final Fantasy V (gra komputerowa)' }, { title: 'Final Fantasy' }, { title: 'Dragon Quest V' }])).toEqual([
      'Final Fantasy V (gra komputerowa)'
    ])
  })

  it('najpierw polska, bez artykułu — angielska; strona ujednoznaczniająca pomijana; wynik zapisany', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'lumen-wiki-'))
    const asked: string[] = []
    const fetcher = (async (url: string) => {
      asked.push(url)
      const json = (x: unknown): Response => new Response(JSON.stringify(x))
      if (url.includes('pl.wikipedia.org/w/api.php')) return json({ query: { search: [{ title: 'Final Fantasy V' }] } })
      if (url.includes('pl.wikipedia.org/api/rest_v1')) return json({ type: 'disambiguation', extract: 'Final Fantasy V może oznaczać' })
      if (url.includes('en.wikipedia.org/w/api.php')) return json({ query: { search: [{ title: 'Final Fantasy V' }] } })
      return json({ type: 'standard', extract: 'Final Fantasy V is a 1992 role-playing video game.', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Final_Fantasy_V' } } })
    }) as unknown as typeof fetch
    const w = new WikipediaDescriptions(path.join(dir, 'wiki.json'), fetcher as never)
    const s = await w.summary('FINAL FANTASY V™')
    expect(s).toMatchObject({ lang: 'en', title: 'Final Fantasy V', text: 'Final Fantasy V is a 1992 role-playing video game.' })
    const n = asked.length
    // drugi raz — z zapisu, bez sieci; także w nowym obiekcie (z dysku)
    expect(await w.summary('Final Fantasy V')).toEqual(s)
    expect(await new WikipediaDescriptions(path.join(dir, 'wiki.json'), fetcher as never).summary('Final Fantasy V')).toEqual(s)
    expect(asked.length).toBe(n)
  })

  it('brak sieci nie jest zapisywany jako „brak artykułu”', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'lumen-wiki-'))
    let online = false
    const fetcher = (async (url: string) => {
      if (!online) throw new Error('offline')
      return new Response(JSON.stringify(url.includes('api.php') ? { query: { search: [{ title: 'Halo Infinite' }] } } : { extract: 'Halo Infinite – gra.' }))
    }) as unknown as typeof fetch
    const w = new WikipediaDescriptions(path.join(dir, 'wiki.json'), fetcher as never)
    expect(await w.summary('Halo Infinite')).toBeNull()
    online = true
    expect((await w.summary('Halo Infinite'))?.text).toBe('Halo Infinite – gra.')
  })
})

describe('Wikipedia — odmowa 429', () => {
  it('po odmowie przerwa bez pytań i bez zapisu „brak artykułu”', async () => {
    const { HttpError } = await import('../src/main/net')
    const d = mkdtempSync(path.join(tmpdir(), 'lumen-wiki-'))
    let calls = 0
    const fetcher = (async () => {
      calls++
      throw new HttpError(429, 'HTTP 429')
    }) as unknown as typeof fetch
    const w = new WikipediaDescriptions(path.join(d, 'wiki.json'), fetcher as never)
    expect(await w.summary('Halo Infinite')).toBeNull()
    expect(await w.summary('Forza Horizon 5')).toBeNull()
    expect(calls).toBe(1)
    rmSync(d, { recursive: true, force: true })
  })
})
