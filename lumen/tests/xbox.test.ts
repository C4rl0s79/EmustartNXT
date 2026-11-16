import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/main/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { parseInstalled } from '../src/main/xbox/installed'
import { productOf } from '../src/main/xbox/catalog'
import { xboxGames } from '../src/main/xbox/provider'
import { classify, classifyContext } from '@shared/libraryNav'

// Gry Xbox / Microsoft Store (etap 19, zgłoszenie 2026-11-16) — kształt danych z tego komputera i z katalogu Microsoft.

const FF6 = { pfn: '39EA002F.FF6DF_n746a19ndrrjg', aumid: '39EA002F.FF6DF_n746a19ndrrjg!Game', storeId: '9N255K81XBD3', titleId: '66fcee48', name: 'FINAL FANTASY VI', location: 'C:\\Program Files\\WindowsApps\\x' }

describe('gry zainstalowane (PowerShell → lista)', () => {
  it('jeden obiekt albo tablica; niepoprawne identyfikatory odrzucone', () => {
    expect(parseInstalled('\uFEFF' + JSON.stringify(FF6))).toEqual([FF6])
    expect(parseInstalled(JSON.stringify([FF6, { ...FF6, aumid: 'x & calc' }])).length).toBe(1)
    expect(parseInstalled('')).toEqual([])
    expect(parseInstalled('zepsute')).toEqual([])
  })
})

describe('katalog Microsoft', () => {
  it('produkt: nazwa, rodzina pakietu, grafiki (https), identyfikator tytułu szesnastkowo, rok', () => {
    const p = productOf({
      ProductId: '9p8lr42ptrgj',
      LocalizedProperties: [
        {
          ProductTitle: '33 Immortals',
          Images: [
            { ImagePurpose: 'Poster', Uri: '//store-images.s-microsoft.com/image/a', Width: 720, Height: 1080 },
            { ImagePurpose: 'Poster', Uri: '//store-images.s-microsoft.com/image/b', Width: 1440, Height: 2160 },
            { ImagePurpose: 'SuperHeroArt', Uri: 'http://zly/adres', Width: 1920, Height: 1080 }
          ]
        }
      ],
      DisplaySkuAvailabilities: [{ Sku: { Properties: { Packages: [{ PackageFamilyName: '44905ThunderLotusGames.33Immortals_hbhkcnqstm4gr' }] } } }],
      AlternateIds: [{ IdType: 'XboxTitleId', Value: '2141212892' }],
      MarketProperties: [{ OriginalReleaseDate: '2025-03-18T00:00:00.0000000Z' }]
    })!
    expect(p).toEqual({
      storeId: '9P8LR42PTRGJ',
      title: '33 Immortals',
      pfn: '44905ThunderLotusGames.33Immortals_hbhkcnqstm4gr',
      titleId: (2141212892).toString(16),
      poster: 'https://store-images.s-microsoft.com/image/b',
      year: 2025
    })
    expect(productOf({ ProductId: 'x', LocalizedProperties: [{ ProductTitle: 'A' }] })).toBeNull()
  })
})

describe('gry Xbox w bibliotece', () => {
  const cache = {
    at: 1,
    gamePass: ['9N255K81XBD3', '9P8LR42PTRGJ', '9NOTINCATAL'],
    products: {
      '9N255K81XBD3': { storeId: '9N255K81XBD3', title: 'FINAL FANTASY VI', pfn: FF6.pfn },
      '9P8LR42PTRGJ': { storeId: '9P8LR42PTRGJ', title: '33 Immortals', poster: 'https://x/p' },
      '9NHALOMCCXXX': { storeId: '9NHALOMCCXXX', title: 'Halo: The Master Chief Collection' }
    }
  }
  it('zainstalowana z Game Pass — jedna pozycja; z konta i z katalogu Game Pass — bez instalacji; grupy Xbox / Game Pass', () => {
    const games = xboxGames([FF6], cache, new Set(['9NHALOMCCXXX']))
    expect(games.map((g) => [g.id, g.installed, g.xbox!.gamePass, g.xbox!.owned])).toEqual([
      ['xbox:9N255K81XBD3', true, true, false],
      ['xbox:9NHALOMCCXXX', false, false, true],
      ['xbox:9P8LR42PTRGJ', false, true, false]
    ])
    expect(games[0].xbox!.aumid).toBe(FF6.aumid)
    const ctx = classifyContext([], [], {})
    expect(games.map((g) => classify(g, ctx).id)).toEqual(['xbox', 'xbox', 'gamepass'])
    expect(xboxGames([FF6], cache, new Set(), false).map((g) => g.id)).toEqual(['xbox:9N255K81XBD3']) // bez katalogu Game Pass
  })
})
