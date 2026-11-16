import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/main/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, registerSecret: vi.fn() }))

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

vi.mock('electron', () => ({ BrowserWindow: class {}, session: { fromPartition: () => ({ clearStorageData: async () => undefined }) } }))

describe('konto Xbox (etap 19c)', () => {
  it('adres logowania z PKCE; powrót: kod, błąd, obcy state', async () => {
    const { authorizeUrl, redirectResult, REDIRECT } = await import('../src/main/xbox/account')
    const { url, state } = authorizeUrl('11111111-2222-3333-4444-555555555555')
    const q = new URL(url).searchParams
    expect(q.get('client_id')).toBe('11111111-2222-3333-4444-555555555555')
    expect(q.get('code_challenge_method')).toBe('S256')
    expect(q.get('scope')).toBe('XboxLive.signin offline_access')
    expect(redirectResult('https://login.live.com/x', state)).toBeNull()
    expect(redirectResult(`${REDIRECT}?code=abc&state=${state}`, state)).toEqual({ code: 'abc' })
    expect(redirectResult(`${REDIRECT}?code=abc&state=inny`, state)?.error).toMatch(/state/)
    expect(redirectResult(`${REDIRECT}?error=access_denied&error_description=Odmowa`, state)).toEqual({ error: 'Odmowa' })
  })

  it('historia tytułów: tylko gry na PC, StoreId z dostępności albo rodzina pakietu', async () => {
    const { parseTitles } = await import('../src/main/xbox/account')
    expect(
      parseTitles({
        titles: [
          { name: 'Halo MCC', type: 'Game', devices: ['XboxOne', 'PC'], detail: { availabilities: [{ ProductId: '9nblggh4rk76' }] } },
          { name: 'Forza (konsola)', type: 'Game', devices: ['XboxSeries'], productId: '9NXXXXXXXXXX' },
          { name: 'Aplikacja', type: 'App', devices: ['PC'] },
          { name: 'FF6', type: 'Game', devices: ['PC'], pfn: '39EA002F.FF6DF_n746a19ndrrjg' }
        ]
      })
    ).toEqual([
      { storeId: '9NBLGGH4RK76', name: 'Halo MCC' },
      { pfn: '39EA002F.FF6DF_n746a19ndrrjg', name: 'FF6' }
    ])
  })
})

describe('katalog: zła odpowiedź to błąd, nie pusta lista (przegląd kodu)', () => {
  it('pusty katalog Game Pass i odpowiedź bez produktów — wyjątek (stara kopia zostaje)', async () => {
    const { gamePassIds, products } = await import('../src/main/xbox/catalog')
    const answer = (body: unknown) => (async () => ({ json: async () => body })) as unknown as typeof import('../src/main/net').fetchWithTimeout
    await expect(gamePassIds(answer([{ siglId: 'x' }]))).rejects.toThrow(/bez gier/)
    await expect(gamePassIds(answer({ error: 'x' }))).rejects.toThrow(/bez gier/)
    expect(await gamePassIds(answer([{ siglId: 'x' }, { id: '9p8lr42ptrgj' }]))).toEqual(['9P8LR42PTRGJ'])
    await expect(products(['9P8LR42PTRGJ'], answer({ error: 'x' }))).rejects.toThrow(/zła odpowiedź/)
  })
})

describe('logowanie bez Azure (publiczny identyfikator Xbox) i z Azure', () => {
  it('sposób zależny od ustawienia; zapisane logowanie pamięta identyfikator', async () => {
    const { flowFor, authorizeUrl, redirectResult, packLogin, unpackLogin, XBOX_PUBLIC_CLIENT } = await import('../src/main/xbox/account')
    const live = flowFor(undefined)
    expect([live.clientId, live.rps, live.pkce]).toEqual([XBOX_PUBLIC_CLIENT, 't=', false])
    const q = new URL(authorizeUrl(live).url).searchParams
    expect(q.get('scope')).toBe('service::user.auth.xboxlive.com::MBI_SSL')
    expect(q.get('code_challenge')).toBeNull()
    const { state } = authorizeUrl(live)
    expect(redirectResult(`https://login.live.com/oauth20_desktop.srf?code=M.x&state=${state}`, state, live.redirect)).toEqual({ code: 'M.x' })
    const az = flowFor('11111111-2222-3333-4444-555555555555')
    expect([az.rps, az.pkce]).toEqual(['d=', true])
    expect(unpackLogin(packLogin(XBOX_PUBLIC_CLIENT, 'M.R3_BAY.-abc!*'))).toEqual({ clientId: XBOX_PUBLIC_CLIENT, refresh: 'M.R3_BAY.-abc!*' })
    expect(unpackLogin('stary-token-bez-identyfikatora')).toBeNull()
    expect(unpackLogin(undefined)).toBeNull()
  })
})

describe('Xbox Live: forma biletu i przyczyna odmowy (zgłoszenie 2026-11-16: HTTP 403 przy logowaniu)', () => {
  it('pierwsza forma odrzucona — następna przyjęta; odmowa XSTS z kodem — czytelny powód', async () => {
    const { xblIdentity, rpsCandidates, xerrText } = await import('../src/main/xbox/account')
    expect(rpsCandidates('TOK', 't=')).toEqual(['t=TOK', 'd=TOK', 'TOK'])
    expect(xerrText('2148916233')).toMatch(/profilu Xbox/)
    const seen: string[] = []
    const reply = (status: number, body: unknown, xerr?: string) =>
      new Response(JSON.stringify(body), { status, headers: xerr ? { 'x-err': xerr } : {} })
    vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
      const b = JSON.parse(init.body)
      if (url.includes('user.auth')) {
        seen.push(b.Properties.RpsTicket.slice(0, 2))
        return b.Properties.RpsTicket.startsWith('d=') ? reply(200, { Token: 'USER' }) : reply(403, {})
      }
      return reply(200, { Token: 'XSTS', DisplayClaims: { xui: [{ uhs: 'U', xid: '25', gtg: 'Gracz' }] } })
    })
    expect(await xblIdentity('TOK', 't=')).toEqual({ uhs: 'U', xuid: '25', gamertag: 'Gracz', token: 'XSTS' })
    expect(seen).toEqual(['t=', 'd='])
    vi.stubGlobal('fetch', async (url: string) =>
      url.includes('user.auth') ? reply(200, { Token: 'USER' }) : reply(401, { XErr: 2148916238 })
    )
    await expect(xblIdentity('TOK', 't=')).rejects.toThrow(/konto dziecka/)
    vi.unstubAllGlobals()
  })
})
