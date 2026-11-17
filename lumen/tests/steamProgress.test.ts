import { describe, expect, it } from 'vitest'
import type { Game, Job } from '@shared/types'
import { RateMeter, steamJobs } from '../src/main/core/jobs'
import { downloadingNow, onDeck } from '@shared/deck'
import { tileJob, tileProgress } from '../src/renderer/src/deck/DeckPanel'

// Etap 7 (2026-11-17): postęp pobierania Steam — prędkość i czas do końca z liczników manifestu; pasek na kafelku Decka.

const MB = 1024 * 1024

function steamGame(done: number, total: number, installState: Game['installState'] = 'installing'): Game {
  return {
    id: 'steam:10',
    appId: 10,
    source: 'steam',
    name: 'Gra',
    installState,
    installed: false,
    progress: { bytesDownloaded: done, bytesToDownload: total, bytesStaged: 0, bytesToStage: 0 }
  } as unknown as Game
}

describe('RateMeter', () => {
  it('prędkość i czas do końca z dwóch odczytów odległych o ≥ 2 s', () => {
    let t = 0
    const m = new RateMeter(30_000, () => t)
    expect(m.sample('a', 0, 100 * MB)).toEqual({})
    t = 1000
    expect(m.sample('a', 5 * MB, 100 * MB)).toEqual({}) // za krótko na pewną prędkość
    t = 10_000
    const r = m.sample('a', 50 * MB, 100 * MB)
    expect(r.speed).toBe(5 * MB)
    expect(r.eta).toBe(10)
  })

  it('mniejszy licznik albo inna wielkość pobierania — od nowa', () => {
    let t = 0
    const m = new RateMeter(30_000, () => t)
    m.sample('a', 0, 100)
    t = 5000
    m.sample('a', 50, 100)
    t = 6000
    expect(m.sample('a', 10, 200)).toEqual({})
  })

  it('stare odczyty wypadają z okna; liczniki stoją → prędkość maleje', () => {
    let t = 0
    const m = new RateMeter(10_000, () => t)
    m.sample('a', 0, 1000)
    t = 5000
    expect(m.sample('a', 500, 1000).speed).toBe(100)
    t = 20_000
    expect(m.sample('a', 500, 1000)).toEqual({}) // tylko odczyty z tą samą wartością w oknie
  })
})

describe('steamJobs z prędkością (etap 7)', () => {
  it('zadanie Steam ma procent, prędkość i czas do końca; wstrzymane — bez prędkości', () => {
    let t = 0
    const m = new RateMeter(30_000, () => t)
    steamJobs([steamGame(0, 100 * MB)], m)
    t = 4000
    const [j] = steamJobs([steamGame(20 * MB, 100 * MB)], m)
    expect(j.progress).toEqual({ done: 20 * MB, total: 100 * MB, speed: 5 * MB, eta: 16 })
    t = 8000
    const [p] = steamJobs([steamGame(20 * MB, 100 * MB, 'updatePaused')], m)
    expect(p.progress).toEqual({ done: 20 * MB, total: 100 * MB })
    expect(p.state).toBe('queued')
  })

  it('bez miernika — jak dotąd (sam procent)', () => {
    const [j] = steamJobs([steamGame(1, 4)])
    expect(j.progress).toEqual({ done: 1, total: 4 })
  })
})

describe('Deck: pobierane gry i pasek na kafelku', () => {
  it('gra pobierana po raz pierwszy jest w Decku', () => {
    const g = steamGame(1, 2)
    expect(downloadingNow(g)).toBe(true)
    expect(onDeck(g)).toBe(true)
    expect(onDeck({ ...g, installState: 'notInstalled' } as Game)).toBe(false)
  })

  it('tekst paska: procent, prędkość, czas; bez liczb — etap; uruchomienie gry — bez paska', () => {
    const job = { kind: 'steamDownload', state: 'active', phase: 'Instalacja w Steam', progress: { done: 45, total: 100, speed: 12 * MB, eta: 180 } } as Job
    expect(tileProgress(job)).toEqual({ pct: 45, text: '45% · 12,0 MB/s · 3 min 0 s' })
    expect(tileProgress({ ...job, progress: undefined })).toEqual({ pct: null, text: 'Instalacja w Steam' })
    expect(tileProgress({ ...job, kind: 'emuLaunch' })).toBeNull()
    expect(tileProgress({ ...job, state: 'done' })).toBeNull()
    expect(tileProgress(undefined)).toBeNull()
  })

  it('kafelek bierze trwające zadanie gry — aktywne przed czekającym, bez zakończonych i uruchomienia', () => {
    const j = (kind: Job['kind'], state: Job['state'], phase: string): Job => ({ kind, state, phase, gameId: 'g' }) as Job
    const jobs = [j('gogInstall', 'done', 'Koniec'), j('gogInstall', 'queued', 'Dodatki'), j('gogInstall', 'active', 'Instalacja'), j('emuLaunch', 'active', 'Gra')]
    expect(tileJob(jobs, 'g')?.phase).toBe('Instalacja')
    expect(tileJob(jobs.slice(0, 2), 'g')?.phase).toBe('Dodatki')
    expect(tileJob(jobs, 'inna')).toBeUndefined()
  })
})

describe('RateMeter — przypadki z code review', () => {
  it('reset i ten sam moment (albo cofnięty zegar) nie wywraca licznika', () => {
    let t = 1000
    const m = new RateMeter(30_000, () => t)
    m.sample('a', 50, 100)
    expect(m.sample('a', 10, 100)).toEqual({}) // mniejszy licznik w tej samej chwili
    t = 500
    expect(m.sample('a', 5, 200)).toEqual({}) // zegar się cofnął
  })

  it('liczniki stoją dłużej niż okno — bez prędkości', () => {
    let t = 0
    const m = new RateMeter(10_000, () => t)
    m.sample('a', 0, 1000)
    t = 5000
    expect(m.sample('a', 500, 1000).speed).toBe(100)
    t = 16_000
    expect(m.sample('a', 500, 1000)).toEqual({})
  })
})
