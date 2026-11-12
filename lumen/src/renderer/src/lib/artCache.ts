// Obrazy z lumen-art:// wczytywane w tle i trzymane w pamięci.
//
// <img src="lumen-art://…"> dostaje plik kawałkami, a Chromium obrabia obraz od nowa po każdym kawałku — na wątku
// interfejsu (ślad z sesji gracza: ResponseBodyLoader + ImageResourceContent::updateImage, sekundy przy
// przewijaniu; najgorzej duże animowane plakaty). Tu: cały plik przez fetch → blob w pamięci → dekodowanie w tle
// (decode()) → dopiero wtedy na ekran. Gotowe obrazy zostają (do LIMIT_BYTES, najdawniej używane wypadają), więc
// plakat widziany chwilę wcześniej wraca od razu — bez pobierania i dekodowania.

const LIMIT_BYTES = 256 << 20
const MAX_PARALLEL = 6

interface Entry {
  url: Promise<string>
  /** blob: gotowy (do odczytu bez czekania) */
  ready?: string
  bytes: number
  /** obraz zdekodowany — trzymany, żeby Chromium nie wyrzucił zdekodowanych danych od razu */
  img?: HTMLImageElement
}

const cache = new Map<string, Entry>() // kolejność = ostatnie użycie (najdawniej na początku)
let total = 0
let running = 0
const queue: (() => void)[] = []

function slot(): Promise<void> {
  if (running < MAX_PARALLEL) {
    running++
    return Promise.resolve()
  }
  return new Promise((r) => queue.push(() => (running++, r())))
}
function release(): void {
  running--
  queue.shift()?.()
}

function touch(src: string, e: Entry): void {
  cache.delete(src)
  cache.set(src, e)
}

function evict(): void {
  for (const [src, e] of cache) {
    if (total <= LIMIT_BYTES) break
    if (!e.ready) continue // w drodze — zostaje
    cache.delete(src)
    total -= e.bytes
    URL.revokeObjectURL(e.ready)
  }
}

/** blob: gotowego obrazu bez czekania (albo undefined — jeszcze nie / nie ma). */
export function readyArt(src: string): string | undefined {
  const e = cache.get(src)
  if (!e?.ready) return undefined
  touch(src, e)
  return e.ready
}

/** Obraz: pobrany w całości i zdekodowany w tle; ten sam adres — ten sam wynik (z pamięci). */
export function loadArt(src: string): Promise<string> {
  const have = cache.get(src)
  if (have) {
    touch(src, have)
    return have.url
  }
  const e: Entry = { bytes: 0, url: Promise.resolve('') }
  e.url = (async () => {
    await slot()
    try {
      const res = await fetch(src)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const img = new Image()
      img.decoding = 'async'
      img.src = url
      await img.decode().catch(() => undefined) // uszkodzony obraz — <img> zgłosi błąd sam
      e.bytes = blob.size
      e.ready = url
      e.img = img
      total += blob.size
      evict()
      return url
    } catch (err) {
      cache.delete(src) // następna próba pobierze od nowa
      throw err
    } finally {
      release()
    }
  })()
  cache.set(src, e)
  return e.url
}

/** Obraz, który nie dał się wyświetlić z pamięci (np. wyrzucony w międzyczasie): zapomniany, do pobrania od nowa. */
export function forgetArt(src: string): void {
  const e = cache.get(src)
  if (!e) return
  cache.delete(src)
  if (e.ready) {
    total -= e.bytes
    URL.revokeObjectURL(e.ready)
  }
}

/** for tests */
export function artCacheStats(): { entries: number; bytes: number } {
  return { entries: cache.size, bytes: total }
}
