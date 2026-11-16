import { afterEach, describe, expect, it, vi } from 'vitest'
import { SHOW_AFTER_MS, ServerActivityBoard, savesText, seriesActivity, seriesStatusOf } from '../src/main/serverActivity'

// Wymiana z serwerem widoczna w oknie (prośba 2026-11-16: „skąd mam wiedzieć, że działa?”).

afterEach(() => vi.useRealTimers())

describe('stan serii z IGDB z odpowiedzi silnika', () => {
  it('serwer sprawdza — pasek z liczbami', () => {
    const s = seriesStatusOf(
      { ok: true, enabled: true, progress: { running: true, done: 12480, total: 41300, checked: 20000, in_series: 3912, last_batch: 100, error: '' } },
      5
    )
    expect(s).toEqual({ state: 'ok', running: true, done: 12480, total: 41300, checked: 20000, inSeries: 3912, lastBatch: 100_000, error: undefined, at: 5 })
    const a = seriesActivity(s)!
    expect(a.id).toBe('series')
    expect(a.detail).toMatch(/^sprawdzone 12\s480 z 41\s300$/)
    expect([a.done, a.total]).toEqual([12480, 41300])
  })

  it('stary serwer, brak kluczy, nic nie trwa — bez paska, powód w stanie', () => {
    const old = seriesStatusOf({ ok: false, reason: 'Serwer ma starszą wersję EmuStart — zaktualizuj go w panelu serwera.' })
    expect(old.state).toBe('error')
    expect(old.reason).toMatch(/starszą/)
    expect(seriesActivity(old)).toBeNull()
    const keys = seriesStatusOf({ ok: true, enabled: false })
    expect(keys.state).toBe('nokeys')
    expect(seriesActivity(keys)).toBeNull()
    expect(seriesActivity(seriesStatusOf({ ok: true, enabled: true, progress: { running: false, checked: 5 } }))).toBeNull()
  })
})

describe('zapisy', () => {
  it('opis jak w silniku (syncclient.progress_text)', () => {
    expect(savesText({ active: true, op: 'send', done: 120 * 1048576, total: 262 * 1048576, eta: 70 })).toBe('wysłano 120 / 262 MB · ok. 1 min')
    expect(savesText({ active: true, op: 'get', done: 1048576, total: 5 * 1048576, eta: -1 })).toBe('pobrano 1.0 / 5.0 MB')
  })
})

describe('tablica wymian', () => {
  it('krótka wymiana nie miga paskiem, dłuższa pokazuje się i znika po końcu; ten sam id naraz — jeden pasek', async () => {
    vi.useFakeTimers()
    const b = new ServerActivityBoard()
    const seen: number[] = []
    b.on('change', (l) => seen.push(l.length))
    await b.track('themes', 'Motywy TV', async () => 1)
    await vi.advanceTimersByTimeAsync(SHOW_AFTER_MS + 300)
    expect(b.list()).toEqual([])
    expect(seen).toEqual([])

    let finish!: () => void
    const long = b.track('library', 'Lista gier z serwera', () => new Promise<void>((r) => (finish = r)))
    let finish2!: () => void
    const long2 = b.track('library', 'Lista gier z serwera', () => new Promise<void>((r) => (finish2 = r)))
    await vi.advanceTimersByTimeAsync(SHOW_AFTER_MS + 300)
    expect(b.list()).toEqual([{ id: 'library', label: 'Lista gier z serwera' }])
    finish()
    await long
    expect(b.list().length).toBe(1) // druga jeszcze trwa
    finish2()
    await long2
    await vi.advanceTimersByTimeAsync(300)
    expect(b.list()).toEqual([])
    expect(seen).toEqual([1, 0])
  })
})
