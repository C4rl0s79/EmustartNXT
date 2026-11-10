import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { DatabaseSync } from 'node:sqlite'
import { normTitle, numbersMatch, platformForEs, platformForTags, similarity } from '../src/main/launchbox/match'
import { buildDatabase, parseMetadataXml, type LbGameRow } from '../src/main/launchbox/builder'
import { findGame, toDetails } from '../src/main/launchbox/lookup'
import { LB_TYPES, regionsOfTags, sortImages } from '../src/main/launchbox/images'

const XML = `<?xml version="1.0" standalone="yes"?>
<LaunchBox>
  <Game>
    <Name>Ace Combat 5: The Unsung War</Name>
    <ReleaseYear>2004</ReleaseYear>
    <Overview>Air combat &amp; flight.
Second paragraph.</Overview>
    <MaxPlayers>2</MaxPlayers>
    <DatabaseID>3912</DatabaseID>
    <Platform>Sony Playstation 2</Platform>
    <Developer>Project Aces</Developer>
    <Publisher>Namco</Publisher>
    <Genres>Flight Simulator; Shooter</Genres>
    <CommunityRating>4.2874</CommunityRating>
    <CommunityRatingCount>52</CommunityRatingCount>
    <ESRB>T - Teen</ESRB>
    <Cooperative>true</Cooperative>
    <ReleaseType>Released</ReleaseType>
  </Game>
  <Game>
    <Name>Ace Combat 5: The Unsung War</Name>
    <DatabaseID>421734</DatabaseID>
    <Platform>Sony Playstation 4</Platform>
  </Game>
  <Game>
    <Name>Final Fantasy X</Name>
    <ReleaseDate>2001-07-19T02:00:00+02:00</ReleaseDate>
    <DatabaseID>10</DatabaseID>
    <Platform>Sony Playstation 2</Platform>
    <Overview><![CDATA[Tidus <3]]></Overview>
  </Game>
  <Game>
    <Name>Final Fantasy X-2</Name>
    <DatabaseID>11</DatabaseID>
    <Platform>Sony Playstation 2</Platform>
  </Game>
  <Game>
    <Name>The Legend of Zelda: The Wind Waker</Name>
    <DatabaseID>20</DatabaseID>
    <Platform>Nintendo GameCube</Platform>
  </Game>
  <GameAlternateName>
    <AlternateName>Zelda no Densetsu: Kaze no Takuto</AlternateName>
    <DatabaseID>20</DatabaseID>
    <Region>Japan</Region>
  </GameAlternateName>
  <GameImage>
    <DatabaseID>3912</DatabaseID>
    <FileName>Sony Playstation 2/Ace Combat 5 eu.jpg</FileName>
    <Type>Box - Front</Type>
    <Region>Europe</Region>
  </GameImage>
  <GameImage>
    <DatabaseID>3912</DatabaseID>
    <FileName>Sony Playstation 2/Ace Combat 5 us.jpg</FileName>
    <Type>Box - Front</Type>
    <Region>North America</Region>
  </GameImage>
  <GameImage>
    <DatabaseID>3912</DatabaseID>
    <FileName>Sony Playstation 2/Ace Combat 5 fan.jpg</FileName>
    <Type>Fanart - Background</Type>
  </GameImage>
  <GameImage>
    <DatabaseID>3912</DatabaseID>
    <FileName>Sony Playstation 2/Ace Combat 5 disc.png</FileName>
    <Type>Disc</Type>
  </GameImage>
  <Platform><Name>Sony Playstation 2</Name></Platform>
</LaunchBox>`

describe('title matching helpers (EmuStart rules)', () => {
  it('normalises articles, tags and punctuation', () => {
    expect(normTitle('Legend of Zelda, The - Ocarina of Time (USA)')).toBe(normTitle('The Legend of Zelda: Ocarina of Time'))
    expect(normTitle('Ratchet & Clank')).toBe('ratchetandclank')
    expect(normTitle('Ace Combat 04 - Shattered Skies')).toBe(normTitle('Ace Combat 04: Shattered Skies'))
  })

  it('requires the same sequel numbers', () => {
    expect(numbersMatch('Final Fantasy X', 'Final Fantasy 10')).toBe(true)
    expect(numbersMatch('Part 3', 'Part II')).toBe(false)
    expect(numbersMatch('Ace Combat 5: The Unsung War', 'Ace Combat 5')).toBe(true)
  })

  it('scores similarity with bigrams', () => {
    expect(similarity('abc', 'abc')).toBe(1)
    expect(similarity('Final Fantasy X', 'Kingdom Hearts')).toBeLessThan(0.3)
  })

  it('maps Steam ROM Manager tags to LaunchBox platforms', () => {
    expect(platformForTags(['Non-Steam', 'PS2'])).toBe('Sony Playstation 2')
    expect(platformForTags(['GCN'])).toBe('Nintendo GameCube')
    // EmuStart systems the server has no metadata for: found by title on their LaunchBox platform
    expect([platformForEs('megadrive'), platformForEs('atari2600'), platformForEs('wswanc'), platformForEs('zxspectrum')]).toEqual(['Sega Genesis', 'Atari 2600', 'WonderSwan Color', 'Sinclair ZX Spectrum'])
    expect(platformForEs('nosuch')).toBeUndefined()
    expect(platformForTags(['DC'])).toBe('Sega Dreamcast')
    expect(platformForTags(['PS1'])).toBe('Sony Playstation')
    expect(platformForTags(['Favourites'])).toBeUndefined()
  })
})

describe('LaunchBox database', () => {
  it('streams games and alternate names out of Metadata.xml', async () => {
    const games: LbGameRow[] = []
    const alts: [number, string][] = []
    await parseMetadataXml(Readable.from([XML.slice(0, 300), XML.slice(300)]), (g) => games.push(g), (id, n) => alts.push([id, n]))
    expect(games).toHaveLength(5)
    expect(games[0]).toMatchObject({ id: 3912, platform: 'Sony Playstation 2', year: '2004', overview: 'Air combat & flight.\nSecond paragraph.' })
    expect(games[2]).toMatchObject({ year: '2001', overview: 'Tidus <3' })
    expect(alts).toEqual([[20, 'Zelda no Densetsu: Kaze no Takuto']])
  })

  it('builds a database that finds the right game per platform', async () => {
    const out = path.join(mkdtempSync(path.join(tmpdir(), 'lumen-lb-')), 'launchbox.db')
    expect(await buildDatabase(Readable.from([XML]), out)).toEqual({ games: 5, alts: 1, images: 3 }) // "Disc" not stored
    const db = new DatabaseSync(out, { readOnly: true })
    try {
      expect(findGame(db, 'Ace Combat 5 - The Unsung War', 'Sony Playstation 2')?.id).toBe(3912)
      expect(findGame(db, 'Final Fantasy X', 'Sony Playstation 2')?.id).toBe(10) // not X-2
      expect(findGame(db, 'Final Fantasy X-2', 'Sony Playstation 2')?.id).toBe(11)
      expect(findGame(db, 'Zelda no Densetsu - Kaze no Takuto', 'Nintendo GameCube')?.id).toBe(20) // alternate name
      expect(findGame(db, 'Ace Combat 5: The Unsung War', 'Sega Dreamcast')).toBeNull()
      expect(findGame(db, 'Completely Unknown Game', undefined)).toBeNull()
      // series / subtitle after " - " in the shortcut name
      expect(findGame(db, 'Final Fantasy X - Square Collection', 'Sony Playstation 2')?.id).toBe(10)
      expect(findGame(db, 'Some Series - Unknown Thing', 'Sony Playstation 2')).toBeNull()

      const d = toDetails(findGame(db, 'Ace Combat 5: The Unsung War', 'Sony Playstation 2')!)
      expect(d).toMatchObject({
        source: 'launchbox',
        genres: ['Flight Simulator', 'Shooter'],
        developers: ['Project Aces'],
        publishers: ['Namco'],
        releaseDate: '2004',
        players: '2',
        rating: 4.3,
        ratingCount: 52,
        esrb: 'T - Teen',
        coop: true,
        releaseType: 'Released',
        platform: 'Sony Playstation 2'
      })
      // ratings for sorting a list, by LaunchBox id
      expect(findGame(db, 'Final Fantasy X', 'Sony Playstation 2')?.esrb).toBe('')
      expect(d.descriptionText).toContain('Second paragraph.')
    } finally {
      db.close()
    }
  })
})

describe('LaunchBox images', () => {
  const rows = [
    { type: 'Box - Front', region: 'North America', fn: 'a/us.jpg' },
    { type: 'Box - 3D', region: 'Europe', fn: 'a/3d.jpg' },
    { type: 'Box - Front', region: 'Japan', fn: 'a/jp.jpg' },
    { type: 'Box - Front', region: 'Europe', fn: 'a/eu box.jpg' },
    { type: 'Fanart - Background', region: '', fn: 'a/fan.jpg' }
  ]

  it('orders by type, then the shown version region, then the preference', () => {
    expect(sortImages(rows, LB_TYPES.box, 'europe').map((i) => i.url.split('/').pop())).toEqual(['eu%20box.jpg', 'us.jpg', 'jp.jpg', '3d.jpg'])
    expect(sortImages(rows, LB_TYPES.box, 'europe', regionsOfTags('(Japan)'))[0].region).toBe('Japan')
    expect(sortImages(rows, LB_TYPES.box, 'usa')[0].region).toBe('North America')
    expect(sortImages(rows, LB_TYPES.fanart, 'europe').map((i) => i.type)).toEqual(['Fanart - Background'])
    expect(sortImages(rows, [], 'europe')).toEqual([])
  })

  it('builds image addresses on images.launchbox-app.com only', () => {
    for (const i of sortImages(rows, LB_TYPES.box, 'europe')) expect(i.url.startsWith('https://images.launchbox-app.com/')).toBe(true)
  })

  it('maps No-Intro tags to LaunchBox regions', () => {
    expect(regionsOfTags('(USA, Europe)')).toEqual(['North America', 'United States', 'Europe'])
    expect(regionsOfTags('(Korea)')).toEqual(['Korea'])
    expect(regionsOfTags('(Rev 1)')).toEqual([])
  })

  it('keeps the image list of a game in the database', async () => {
    const out = path.join(mkdtempSync(path.join(tmpdir(), 'lumen-lb-')), 'launchbox.db')
    await buildDatabase(Readable.from([XML]), out)
    const db = new DatabaseSync(out, { readOnly: true })
    try {
      const got = db.prepare('SELECT type, region, fn FROM images WHERE gid = ?').all(3912) as { type: string; region: string; fn: string }[]
      expect(sortImages(got, LB_TYPES.box, 'usa').map((i) => i.region)).toEqual(['North America', 'Europe'])
      expect((db.prepare("SELECT v FROM meta WHERE k = 'schema'").get() as { v: string }).v).toBe('3')
    } finally {
      db.close()
    }
  })
})

describe('store editions in titles (GOG)', () => {
  it('drops the edition at the end, keeps the title', async () => {
    const { editionless } = await import('../src/main/launchbox/match')
    expect(editionless('The Witcher 3: Wild Hunt - Game of the Year Edition')).toEqual(['The Witcher 3: Wild Hunt'])
    expect(editionless("The Witcher: Enhanced Edition Director's Cut")).toContain('The Witcher')
    expect(editionless('Heroes of Might and Magic® 3: Complete')).toEqual(['Heroes of Might and Magic 3'])
    expect(editionless('Divinity: Original Sin - Enhanced Edition')).toEqual(['Divinity: Original Sin'])
    expect(editionless('Fallout 2')).toEqual([])
    expect(editionless('Deluxe')).toEqual([])
    expect(editionless('Pac-Man Championship Edition')).toEqual([]) // no separator before the edition: one title
    expect(editionless('Pac-Man: Championship Edition')).toEqual(['Pac-Man'])
  })
})

describe('closest edition of a store title (GOG)', () => {
  const game = (id: number, name: string, platform = 'Windows'): string =>
    `<Game><Name>${name}</Name><DatabaseID>${id}</DatabaseID><Platform>${platform}</Platform></Game>`
  const xml = (games: string[]): string => `<?xml version="1.0" standalone="yes"?><LaunchBox>${games.join('')}</LaunchBox>`

  it('picks the edition that fits the store title, else the other one', async () => {
    const { findEdition } = await import('../src/main/launchbox/lookup')
    const out = path.join(mkdtempSync(path.join(tmpdir(), 'lumen-lb-')), 'launchbox.db')
    await buildDatabase(
      Readable.from([
        xml([
          game(1, 'The Witcher 3: Wild Hunt'),
          game(2, 'The Witcher 3: Wild Hunt - Game of the Year Edition'),
          game(3, 'The Witcher 2: Assassins of Kings'),
          game(4, 'Divinity: Original Sin - Enhanced Edition'),
          game(5, 'Heroes of Might and Magic III: Complete', 'MS-DOS'),
          game(6, 'Star Wars', 'MS-DOS')
        ])
      ]),
      out
    )
    const db = new DatabaseSync(out, { readOnly: true })
    try {
      expect(findEdition(db, 'The Witcher 3: Wild Hunt', 'Windows')?.id).toBe(1)
      expect(findEdition(db, 'The Witcher 3 Wild Hunt - Game of the Year Edition', 'Windows')?.id).toBe(2)
      expect(findEdition(db, 'The Witcher 3: Wild Hunt - Complete Edition', 'Windows')?.id).toBeOneOf([1, 2])
      expect(findEdition(db, 'Divinity: Original Sin', 'Windows')?.id).toBe(4) // only the enhanced one in the database
      expect(findEdition(db, 'The Witcher 2', 'Windows')?.id).toBe(3) // main title without the subtitle
      expect(findEdition(db, 'The Witcher 2: Assassins of Kings Enhanced Edition', 'Windows')?.id).toBe(3)
      expect(findEdition(db, 'The Witcher', 'Windows')).toBeNull() // another number: not the same game
      expect(findEdition(db, 'Original Sin', 'Windows')).toBeNull() // a subtitle alone is not the title
      expect(findEdition(db, 'Heroes of Might and Magic® III', 'MS-DOS')?.id).toBe(5)
      expect(findEdition(db, 'The Witcher 3: Wild Hunt', 'MS-DOS')).toBeNull()
      expect(findEdition(db, 'Star Wars: Rebel Assault', 'MS-DOS')).toBeNull() // a franchise's first game is not this one
    } finally {
      db.close()
    }
  })
})
