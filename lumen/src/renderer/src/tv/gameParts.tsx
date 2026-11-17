import { useEffect, useState, type ReactNode } from 'react'
import type { DetailsResult, EmuGameOptions, Game } from '@shared/types'
import { api, useStore } from '../store'
import { loadArt, readyArt } from '../lib/artCache'
import { Art } from '../components/Art'
import { useGameJob } from '../components/Jobs'
import { formatBytes, formatLastPlayed, plural, formatPlaytime, htmlToParagraphs, stateLabel } from '../lib/format'

// Parts of a game shown in the TV layout, shared by the game list (TvGames) and the game page (TvGamePage):
// the details read after a short pause on a game, its logo, description, background, EmuStart's own data
// and the facts about it, grouped the same way everywhere.

const details: Record<string, DetailsResult> = {}

export function useDetails(game: Game | undefined): DetailsResult | null {
  const [d, setD] = useState<DetailsResult | null>(null)
  useEffect(() => {
    if (!game) return setD(null)
    if (details[game.id]) return setD(details[game.id])
    setD(null)
    let alive = true
    const t = setTimeout(() => {
      void api()
        .game.details(game.id)
        .then((r) => {
          details[game.id] = r
          if (alive) setD(r)
        })
        .catch(() => undefined)
    }, 220) // fast scrolling does not fetch every row on the way
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [game])
  return d
}

/** The game's logo instead of its title; the title stays until the logo has loaded (and when there is none). */
export function LogoTitle({ game, text }: { game: Game; text: ReactNode }) {
  const [ok, setOk] = useState(false)
  // logo (mała kopia) — znane z pamięci od razu, nowe dopiero gdy wybór stanie na ~350 ms: przy przytrzymanym
  // kierunku nie wczytuje się logo każdej mijanej gry (pomiar: logo przy każdym kroku, pełne pliki)
  const rev = useStore((s) => s.artRev[game.id] ?? 0)
  const [show, setShow] = useState(() => !!readyArt(api().art.url(game.id, 'logo', rev, true)))
  useEffect(() => {
    if (show) return
    const t = setTimeout(() => setShow(true), 350)
    return () => clearTimeout(t)
  }, [show])
  return (
    <>
      {!ok && text}
      {show && (
        <span className={`tv-logo ${ok ? '' : 'is-wait'}`}>
          <Art gameId={game.id} name={game.name} kind="logo" className="tv-logo__img" fallback="none" eager thumb onState={setOk} />
        </span>
      )}
    </>
  )
}

// logo bez pliku (404): nie pobierać go przy każdym zatrzymaniu wyboru obok (do ponownego uruchomienia okna)
const noLogo = new Set<string>()

/** gry obok wybranej (`idx`), do `around` z każdej strony; lista idzie w kółko */
export function neighbourGames(games: Game[], idx: number, around: number): Game[] {
  const count = games.length
  const out: Game[] = []
  for (let step = 1; step <= around; step++)
    for (const pos of [idx + step, idx - step]) out.push(games[((pos % count) + count) % count])
  return out
}

/** logo do pamięci obrazów, chyba że już tam jest albo go nie ma (404); inny błąd (sieć, 5xx) — następnym razem od nowa */
export function prefetchLogo(url: string): void {
  if (noLogo.has(url) || readyArt(url)) return
  loadArt(url).catch((err: unknown) => {
    if (err instanceof Error && err.message === 'HTTP 404') noLogo.add(url)
  })
}

/**
 * Logo gier obok wybranej, wczytane do pamięci obrazów, gdy wybór stoi (`settled`) — jak okładki na wstędze:
 * krok w bok pokazuje logo od razu (LogoTitle bierze je z pamięci bez czekania), zamiast pobierać je dopiero
 * po wyświetleniu gry. Przy przytrzymanym kierunku nic się nie pobiera (wybór nie stoi).
 */
export function usePrefetchLogos(games: Game[], idx: number, settled: boolean, around = 2): void {
  useEffect(() => {
    if (!settled || games.length < 2) return
    // wersje grafik czytane tu, bez subskrypcji: zmiana grafiki dowolnej gry nie rysuje od nowa całej listy
    const artRev = useStore.getState().artRev
    for (const game of neighbourGames(games, idx, around)) prefetchLogo(api().art.url(game.id, 'logo', artRev[game.id] ?? 0, true))
  }, [settled, idx, games, around])
}

/**
 * A description longer than its box: marked "is-cut" (the CSS fades the last line) and, after a pause
 * on the game, scrolled slowly to its end and back (tv.css: --tv-desc-d distance, --tv-desc-t time) —
 * about two seconds per line, so it can be read from the couch without pressing anything.
 */
function useDescScroll(): (el: HTMLDivElement | null) => void {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!el) return
    const check = (): void => {
      const inner = el.firstElementChild as HTMLElement | null
      const over = (inner?.scrollHeight ?? el.scrollHeight) - el.clientHeight
      const cut = over > 1
      el.classList.toggle('is-cut', cut)
      if (!cut) return
      const line = parseFloat(getComputedStyle(el).lineHeight) || 24
      el.style.setProperty('--tv-desc-d', `${Math.ceil(over)}px`)
      // the move takes 80% of one way (pauses at both ends), at ~2 s per line
      el.style.setProperty('--tv-desc-t', `${Math.max(6, ((over / line) * 2) / 0.8).toFixed(1)}s`)
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    const mo = new MutationObserver(check)
    mo.observe(el, { childList: true, subtree: true, characterData: true })
    return () => {
      ro.disconnect()
      mo.disconnect()
    }
  }, [el])
  return setEl
}

/** The game's description; longer than its box it scrolls slowly after a pause (useDescScroll). */
export function TvDesc({ game, details: dr, className }: { game: Game; details: DetailsResult | null; className?: string }) {
  const d = dr?.ok ? dr.details : undefined
  const descRef = useDescScroll()
  const desc = d?.descriptionText ? d.descriptionText.split(/\n+/) : d?.descriptionHtml ? htmlToParagraphs(d.descriptionHtml, 20) : d?.shortDescription ? [d.shortDescription] : []
  return (
    <div className={`tv-desc ${className ?? ''}`} ref={descRef}>
      {/* keyed by game: a new game starts its description from the top (and its scroll from the pause) */}
      <div className="tv-desc__in" key={game.id}>
        {desc.slice(0, 20).map((p, i) => (
          <p key={i}>{p}</p>
        ))}
        {game.source !== 'emustart' && !desc.length && (
          <p>
            {game.source === 'gog'
              ? 'Gra GOG z archiwum serwera EmuStart.'
              : game.source === 'xbox'
                ? game.xbox?.gamePass && !game.installed && !game.xbox.owned
                  ? 'Gra z PC Game Pass.'
                  : 'Gra Xbox / Microsoft Store.'
                : game.source === 'shortcut'
                  ? 'Skrót Steam do gry spoza sklepu.'
                  : 'Gra z biblioteki Steam.'}
          </p>
        )}
      </div>
    </div>
  )
}

/** The selected game's background art over the whole screen (ribbon layout), faded into the theme. */
export function TvBackdrop({ game }: { game: Game }) {
  return (
    <div className="tv-backdrop" aria-hidden="true">
      <Art gameId={game.id} name={game.name} kind="hero" fallback="none" eager thumb />
    </div>
  )
}

/** EmuStart's own data of the shown game (emulator, saves, bytes on this PC) — after a short pause on it */
const emuOptions: Record<string, EmuGameOptions> = {}
/** forget EmuStart's data of one game (after "Opcje gry": emulator, saves or download may have changed) */
export function forgetEmuOptions(id: string): void {
  for (const k of Object.keys(emuOptions)) if (k.startsWith(`${id}|`)) delete emuOptions[k]
}
export function useEmuOptions(game: Game, rev: number): EmuGameOptions | null {
  const [o, setO] = useState<EmuGameOptions | null>(null)
  // remembered per download state: after a download ends (or the copy is removed) it is read again
  const e = game.emu
  const key = e ? `${game.id}|${e.cached}|${e.copying}|${e.pinned}` : ''
  useEffect(() => {
    if (!key) return setO(null)
    if (emuOptions[key]) return setO(emuOptions[key])
    setO(null)
    let alive = true
    const t = setTimeout(() => {
      void api()
        .emustart.gameOptions(game.id)
        .then((r) => {
          emuOptions[key] = r
          if (alive) setO(r)
        })
        .catch(() => undefined)
    }, 300)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [key, rev]) // eslint-disable-line react-hooks/exhaustive-deps
  return o
}

export function saveLine(o: EmuGameOptions): string {
  const s = o.sync
  const st = s.state === 'synced' ? 'zsynchronizowane' : s.state === 'pending' ? 'czekają na wysłanie' : 'jeszcze nie synchronizowane'
  return `${o.states ? `${o.states} ${plural(o.states, 'stan', 'stany', 'stanów')} · ` : ''}${st}`
}

export type FactGroup = 'pc' | 'you' | 'about'
export interface Fact {
  k: string
  v: string
  group: FactGroup
  /** the status value: ready to play (here) or not yet */
  ready?: boolean
}

/** the game's status in a few words: downloading, on this PC, on the server… */
export function useGameStatus(game: Game): { text: string; ready: boolean } {
  const e = game.emu
  const job = useGameJob(game.id)
  const text = e
    ? e.copying
      ? 'pobieranie…'
      : e.pinned
        ? 'zachowana na dysku'
        : e.cached
          ? 'pobrana'
          : 'na serwerze'
    : job
      ? `${job.phase}${job.progress?.total ? ` · ${Math.floor((job.progress.done / job.progress.total) * 100)}%` : ''}`
      : stateLabel(game)
  return { text, ready: !!(e?.cached || game.installed) }
}

/**
 * Everything known about the game, in three groups: on this PC (status, size, emulator, saves), your game
 * (last played, play time) and about the game (year, genre, makers, ratings). Empty values are left out;
 * the ratings of all sources make one line.
 */
export function useGameFacts(game: Game, dr: DetailsResult | null, rev: number): Fact[] {
  const d = dr?.ok ? dr.details : undefined
  const e = game.emu
  const status = useGameStatus(game)
  const o = useEmuOptions(game, rev)
  const size = e ? e.size : game.sizeOnDisk
  const local = o?.local ?? 0
  const ratings = [
    d?.rating ? `★ ${d.rating.toFixed(1).replace('.', ',')}/5${d.ratingCount ? ` (${d.ratingCount} ${plural(d.ratingCount, 'głos', 'głosy', 'głosów')})` : ''}` : '',
    d?.criticScore ? `Metacritic ${d.criticScore}` : '',
    d?.playerScore !== undefined && d.playerReviews ? `Steam ${d.playerScore}% (${d.playerReviews.toLocaleString('pl-PL')})` : ''
  ].filter(Boolean)
  const rows: [FactGroup, string, string | undefined][] = [
    ['pc', 'Status', status.text],
    ['pc', 'Dodatki', game.gog?.extras?.length ? String(game.gog.extras.length) : undefined],
    ['pc', 'Źródło', game.familyShared ? 'Family Sharing' : undefined],
    ['pc', 'Oznaczenia', e?.tags],
    ['pc', 'System', o?.system || (e ? e.system : undefined) || d?.platform],
    ['pc', 'Rozmiar', formatBytes(size)],
    ['pc', 'Pobrano', e && local > 0 && size && local < size ? `${formatBytes(local)} z ${formatBytes(size)}` : undefined],
    ['pc', 'Emulator', o ? o.emulator.label || 'brak emulatora' : undefined],
    ['pc', 'Zapisy', o ? saveLine(o) : undefined],
    ['pc', 'Płyty', e && e.discs > 1 ? String(e.discs) : undefined],
    ['pc', 'Wersje', e?.versions ? String(e.versions.length) : undefined],
    ['you', 'Ostatnio', formatLastPlayed(game.lastPlayed) ?? 'nigdy'],
    ['you', 'Czas gry', formatPlaytime(game.playtimeMinutes) ?? '–'],
    ['you', 'Uruchomienia', d?.plays ? String(d.plays) : undefined],
    ['about', 'Rok', d?.releaseDate || e?.year],
    ['about', 'Gatunek', d?.genres?.join(', ') || e?.genre],
    ['about', 'Producent', d?.developers?.join(', ')],
    ['about', 'Wydawca', d?.publishers?.join(', ')],
    ['about', 'Gracze', d?.players],
    ['about', 'Kooperacja', d?.coop === undefined ? undefined : d.coop ? 'tak' : 'nie'],
    ['about', 'Wiek', d?.esrb],
    ['about', 'Oceny', ratings.length ? ratings.join(' · ') : undefined],
    ['about', 'Wydanie', d?.releaseType && !/^released$/i.test(d.releaseType) ? d.releaseType : undefined]
  ]
  return rows
    .filter((r): r is [FactGroup, string, string] => !!r[2])
    .map(([group, k, v]) => ({ group, k, v, ready: k === 'Status' ? status.ready : undefined }))
}

/** one value row (label / value); the status coloured by whether the game is ready here */
export function FactRow({ f }: { f: Fact }) {
  return (
    <div className="tv-dlrow">
      <dt>{f.k}</dt>
      <dd className={f.ready === undefined ? 'selectable' : f.ready ? 'st-c' : 'st-n'}>{f.v}</dd>
    </div>
  )
}


/** the state of a game in one word, for the one tag on its row / poster (the most important state wins) */
export function stateTag(game: Game): { label: string; kind: 'run' | 'dl' | 'ok' | 'keep' } | null {
  const e = game.emu
  if (game.running) return { label: 'w grze', kind: 'run' }
  if (e?.copying) return { label: 'pobieranie', kind: 'dl' }
  if (e?.pinned) return { label: 'na dysku', kind: 'keep' }
  if (e ? e.cached : game.installed) return { label: e ? 'lokalnie' : 'zainstalowana', kind: 'ok' }
  return null
}

/**
 * The game in short, for the lists (instead of the bar with every detail): its logo (or title) and one line —
 * the status, the play time (or "nigdy"), the year and the system. Everything else is on the game's page (A).
 */
export function TvSummary({ game, details: dr, note, className }: { game: Game; details: DetailsResult | null; note?: string; className?: string }) {
  const d = dr?.ok ? dr.details : undefined
  const e = game.emu
  const status = useGameStatus(game)
  const minutes = game.playtimeMinutes ?? 0
  const year = (d?.releaseDate || e?.year || '').match(/\d{4}/)?.[0]
  const parts = [
    minutes > 0 ? `grano ${formatPlaytime(minutes)}` : game.lastPlayed ? `ostatnio: ${formatLastPlayed(game.lastPlayed)?.toLowerCase()}` : 'jeszcze nie grana',
    year,
    e ? e.system : d?.platform
  ].filter((p): p is string => !!p)
  return (
    <div className={`tv-summary ${className ?? ''}`}>
      <div className="tv-summary__logo">
        <LogoTitle key={game.id} game={game} text={<h1>{game.name}</h1>} />
      </div>
      <p className="tv-summary__facts">
        <span className={`tv-summary__status ${status.ready ? 'st-c' : 'st-n'}`}>● {status.text}</span>
        {parts.map((p) => (
          <span key={p}>{p}</span>
        ))}
      </p>
      {note && <p className="tv-note">{note}</p>}
    </div>
  )
}
