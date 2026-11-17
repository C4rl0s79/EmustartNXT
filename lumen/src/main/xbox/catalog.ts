import { fetchWithTimeout } from '../net'

/**
 * Katalog Microsoft (etap 19b): lista gier PC Game Pass (publiczna, catalog.gamepass.com) i opisy produktów
 * (displaycatalog.mp.microsoft.com: nazwa, rodzina pakietu, grafiki) — bez logowania, bez danych gracza.
 */
export interface XboxProduct {
  storeId: string
  title: string
  /** nazwa rodziny pakietu (dopasowanie do gry zainstalowanej) */
  pfn?: string
  titleId?: string
  /** adresy grafik: okładka pionowa, tło, kwadrat */
  poster?: string
  hero?: string
  box?: string
  /** rok premiery */
  year?: number
}

/** wszystkie gry PC Game Pass */
export const GAMEPASS_PC = 'fdd9e2a7-0fee-49f6-ad69-4354098401ff'
const MARKET = 'PL'
const LANG = 'pl-pl'
const BATCH = 20

const STORE_ID = /^[0-9A-Z]{12}$/
/** identyfikator produktu Sklepu (9P8LR42PTRGJ) — jedno sprawdzenie dla katalogu, konta, grafik i instalacji */
export const isStoreId = (s: string): boolean => STORE_ID.test(s)

export async function gamePassIds(fetcher = fetchWithTimeout): Promise<string[]> {
  const r = await fetcher(`https://catalog.gamepass.com/sigls/v2?id=${GAMEPASS_PC}&language=${LANG}&market=${MARKET}`, {}, 20_000)
  const list = (await r.json()) as { id?: string }[]
  const ids = [...new Set((Array.isArray(list) ? list : []).map((x) => String(x?.id ?? '').toUpperCase()).filter((id) => STORE_ID.test(id)))]
  // pusty / zły katalog to błąd, nie „Game Pass bez gier” — stara kopia zostaje (przegląd kodu)
  if (!ids.length) throw new Error('katalog PC Game Pass bez gier (zła odpowiedź)')
  return ids
}

const https = (u: unknown): string | undefined => {
  const s = typeof u === 'string' ? u.trim() : ''
  if (!s) return undefined
  return s.startsWith('//') ? `https:${s}` : /^https:\/\//i.test(s) ? s : undefined
}

/** jeden produkt z odpowiedzi displaycatalog → opis (null — nie ma nazwy) */
export function productOf(p: Record<string, unknown>): XboxProduct | null {
  const storeId = String(p.ProductId ?? '').toUpperCase()
  const lp = ((p.LocalizedProperties as Record<string, unknown>[] | undefined) ?? [])[0] ?? {}
  const title = String(lp.ProductTitle ?? '').trim()
  if (!STORE_ID.test(storeId) || !title) return null
  const images = (lp.Images as { ImagePurpose?: string; Uri?: string; Width?: number; Height?: number }[] | undefined) ?? []
  const pick = (purpose: string): string | undefined =>
    https(
      images
        .filter((i) => i.ImagePurpose === purpose)
        .sort((a, b) => (b.Width ?? 0) - (a.Width ?? 0))[0]?.Uri
    )
  const skus = (p.DisplaySkuAvailabilities as { Sku?: { Properties?: { Packages?: { PackageFamilyName?: string }[] } } }[] | undefined) ?? []
  const pfn = skus.flatMap((s) => s.Sku?.Properties?.Packages ?? []).map((x) => x.PackageFamilyName).find((x) => !!x)
  const alt = (p.AlternateIds as { IdType?: string; Value?: string }[] | undefined) ?? []
  const titleId = alt.find((a) => a.IdType === 'XboxTitleId')?.Value
  const market = (p.MarketProperties as { OriginalReleaseDate?: string }[] | undefined) ?? []
  const year = Number(String(market[0]?.OriginalReleaseDate ?? '').slice(0, 4)) || undefined
  const poster = pick('Poster')
  const hero = pick('SuperHeroArt') ?? pick('TitledHeroArt')
  const box = pick('BoxArt')
  return {
    storeId,
    title,
    ...(pfn ? { pfn } : {}),
    ...(titleId ? { titleId: Number(titleId).toString(16).toLowerCase() } : {}),
    ...(poster ? { poster } : {}),
    ...(hero ? { hero } : {}),
    ...(box ? { box } : {}),
    ...(year && year > 1970 && year < 3000 ? { year } : {})
  }
}

/** opis gry ze strony produktu (etap 23a) — pobierany przy otwarciu gry, nie razem z katalogiem */
export interface XboxDetails {
  description?: string
  short?: string
  developer?: string
  publisher?: string
  genres?: string[]
  /** data premiery RRRR-MM-DD */
  release?: string
}

/** jeden produkt z odpowiedzi displaycatalog → opis; pierwszy język z treścią (pl, potem en) */
export function detailsOf(product: Record<string, unknown>): XboxDetails {
  const locales = (product.LocalizedProperties as Record<string, unknown>[] | undefined) ?? []
  const first = (key: string): string | undefined =>
    locales.map((loc) => (typeof loc[key] === 'string' ? (loc[key] as string).trim() : '')).find(Boolean) || undefined
  const props = (product.Properties as { Categories?: unknown; Category?: unknown } | undefined) ?? {}
  const genres = [...(Array.isArray(props.Categories) ? props.Categories : []), props.Category]
    .map((cat) => (typeof cat === 'string' ? cat.trim() : ''))
    .filter((cat, idx, all) => cat && all.indexOf(cat) === idx)
  const market = (product.MarketProperties as { OriginalReleaseDate?: string }[] | undefined) ?? []
  const fields: XboxDetails = {
    description: first('ProductDescription'),
    short: first('ShortDescription'),
    developer: first('DeveloperName'),
    publisher: first('PublisherName'),
    genres: genres.length ? genres : undefined,
    release: releaseDate(market[0]?.OriginalReleaseDate)
  }
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as XboxDetails
}

/** RRRR-MM-DD z daty katalogu; 1601-01-01 i podobne to w katalogu Microsoft „brak daty” */
function releaseDate(raw: unknown): string | undefined {
  const date = /^(\d{4}-\d{2}-\d{2})/u.exec(String(raw ?? ''))?.[1]
  const year = Number(date?.slice(0, 4))
  return date && year > 1970 && year < 3000 ? date : undefined
}

/** opis jednej gry ze strony produktu Microsoft; null — katalog nie zna produktu */
export async function productDetails(storeId: string, fetcher = fetchWithTimeout): Promise<XboxDetails | null> {
  const id = storeId.toUpperCase()
  if (!STORE_ID.test(id)) return null
  const res = await fetcher(`https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${id}&market=${MARKET}&languages=${LANG},en-us`, {}, 20_000)
  const body = (await res.json()) as { Products?: Record<string, unknown>[] }
  if (!Array.isArray(body?.Products)) throw new Error('katalog produktów Microsoft: zła odpowiedź')
  const product = body.Products.find((item) => String(item.ProductId ?? '').toUpperCase() === id)
  return product ? detailsOf(product) : null
}

/** opisy produktów po StoreId (po 20 na pytanie) */
export async function products(ids: string[], fetcher = fetchWithTimeout): Promise<Record<string, XboxProduct>> {
  const out: Record<string, XboxProduct> = {}
  const want = [...new Set(ids.map((x) => x.toUpperCase()).filter((x) => STORE_ID.test(x)))]
  for (let i = 0; i < want.length; i += BATCH) {
    const part = want.slice(i, i + BATCH).join(',')
    const r = await fetcher(`https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${part}&market=${MARKET}&languages=${LANG},en-us`, {}, 30_000)
    const d = (await r.json()) as { Products?: Record<string, unknown>[] }
    if (!Array.isArray(d?.Products)) throw new Error('katalog produktów Microsoft: zła odpowiedź')
    for (const p of d.Products) {
      const x = productOf(p)
      if (x) out[x.storeId] = x
    }
  }
  return out
}
