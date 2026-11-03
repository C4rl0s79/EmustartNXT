import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { DetailsResult, EmuGameOptions, Game } from '@shared/types'
import { api, askText, attempt, useStore } from '../store'
import { useActions } from '../nav/input'
import { Art } from '../components/Art'
import { Icon } from '../components/Icon'
import { SystemLogo } from './SystemLogo'
import { GameOptions } from '../components/GameOptions'
import { usePrimaryAction } from '../lib/primary'
import { formatBytes, formatLastPlayed, plural, formatPlaytime, htmlToParagraphs, stateLabel, versionCountLabel } from '../lib/format'
import { STEAM, type TvSystem } from './data'
import { TvFilters } from './TvFilters'
import { useRatings } from './ratings'
import { activeParts, apply, loadFilter, saveFilter, type Filter } from './filters'
import { useLook } from './look'
import { listTop } from './listWindow'
import { TvCoverflow } from './TvCoverflow'
import type { TvTheme } from './themes'

// Game list of one system (EmuStart look): titles on the left, cover | details | screenshot on the
// right, the description below. The main action is the same as in the desktop details
// (usePrimaryAction); "Opcje gry" (X) opens the same details (saves, art, versions, favourite) for
// now. View is not used: View+Start switches the interface.

const details: Record<string, DetailsResult> = {}

function useDetails(game: Game | undefined): DetailsResult | null {
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

const letterOf = (g: Game): string => {
  const c = g.name.trim().charAt(0).toUpperCase()
  return /[A-ZĄĆĘŁŃÓŚŹŻ]/.test(c) ? c : '#'
}

export function TvGames({
  system,
  onBack,
  onMenu,
  active,
  theme
}: {
  system: TvSystem
  onBack: () => void
  onMenu: () => void
  active: boolean
  theme: TvTheme
}) {
  // the theme decides how the list is shown: titles in a column, or covers on a horizontal ribbon
  const flow = theme.games.layout === 'coverflow'
  const favorites = useStore((s) => s.prefs?.favorites)
  const opened = useStore((s) => s.uiSelection)
  const steam = system.key === STEAM
  // EmuStart's filters, kept per system (X); search (L3) is the filter's first field
  const [filter, setFilterState] = useState<Filter>(() => loadFilter(system.key))
  const setFilter = (f: Filter): void => {
    setFilterState(f)
    saveFilter(system.key, f)
    setIdx(0)
  }
  const [filters, setFilters] = useState(false)
  const [options, setOptions] = useState(false)
  const [infoRev, setInfoRev] = useState(0) // the details bar reads EmuStart's data again after "Opcje gry"
  const isFav = (id: string): boolean => !!favorites?.includes(id)
  const ratings = useRatings(system.games, filter.sort)
  const games = useMemo(() => apply(system.games, filter, isFav, ratings), [system.games, filter, favorites, ratings]) // eslint-disable-line react-hooks/exhaustive-deps
  const activeFilters = activeParts(filter, steam)
  // the game selected on the desktop, found in the list as shown (filters and order applied)
  const [idx, setIdx] = useState(() => Math.max(0, games.findIndex((g) => g.id === opened)))
  const sel = games[Math.min(idx, games.length - 1)]
  const { primary, busy } = usePrimaryAction(sel)
  const d = useDetails(sel)
  const asLogo = useGamesLogo()

  // rows: only the visible window is rendered (systems can have thousands of games)
  const rowsRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(15)
  const [top, setTop] = useState(0)
  const look = useLook() // the row height comes from the look editor
  const hasRows = games.length > 0
  useLayoutEffect(() => {
    const el = rowsRef.current
    if (!el) return
    const measure = (): void => {
      const rh = el.querySelector<HTMLElement>('.tv-row')?.offsetHeight || el.clientHeight / 15
      setVisible(Math.max(3, Math.floor(el.clientHeight / rh)))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [look, hasRows, flow]) // flow: back from the ribbon to the column, the rows are measured again
  useEffect(() => {
    const t = listTop(top, idx, visible, games.length)
    if (t !== top) setTop(t)
  }, [idx, top, visible, games.length])
  useEffect(() => {
    if (idx >= games.length) setIdx(Math.max(0, games.length - 1))
  }, [games.length, idx])
  // the selected game travels to the desktop layout when the mode switches
  useEffect(() => {
    if (sel) api().ui.select(sel.id)
  }, [sel])

  // LB / RB jump a screenful: the rows that fit, or the covers on one side of the ribbon
  const page = flow ? 5 : visible
  const go = (i: number): boolean => {
    if (games.length) setIdx(Math.max(0, Math.min(games.length - 1, i)))
    return true
  }
  const jumpLetter = (dir: 1 | -1): boolean => {
    if (!sel) return true
    const cur = letterOf(sel)
    for (let i = idx + dir; i >= 0 && i < games.length; i += dir) {
      if (letterOf(games[i]) !== cur) {
        // backwards: the first game of that letter
        if (dir < 0) {
          const l = letterOf(games[i])
          while (i > 0 && letterOf(games[i - 1]) === l) i--
        }
        return go(i)
      }
    }
    return go(dir > 0 ? games.length - 1 : 0)
  }
  const play = (): boolean => {
    if (!primary || busy) return true
    if (primary.disabled || !primary.run) useStore.getState().toast(primary.note ?? primary.label, 'info')
    else void primary.run()
    return true
  }

  useActions(
    {
      // column: up / down; ribbon: left / right (the other pair does nothing, so nothing jumps)
      up: () => (flow ? true : go(idx - 1)),
      down: () => (flow ? true : go(idx + 1)),
      left: () => (flow ? go(idx - 1) : true),
      right: () => (flow ? go(idx + 1) : true),
      lb: () => go(idx - page),
      rb: () => go(idx + page),
      lt: () => jumpLetter(-1),
      rt: () => jumpLetter(1),
      confirm: play,
      x: () => {
        setFilters(true)
        return true
      },
      y: () => {
        // one "Opcje gry" window for EmuStart and Steam games (rows differ by what the game supports)
        if (sel) setOptions(true)
        return true
      },
      ls: () => {
        void askText(`Szukaj — ${system.display}`, { initial: filter.q }).then((v) => v !== null && setFilter({ ...filter, q: v.trim() }))
        return true
      },
      rs: () => {
        if (sel) void attempt(api().prefs.toggleFavorite(sel.id))
        return true
      },
      view: () => true,
      back: () => {
        onBack()
        return true
      },
      menu: () => {
        onMenu()
        return true
      }
    },
    {
      enabled: active && !filters && !options,
      hints: [
        ...(flow ? [{ action: 'left' as const, label: 'Gra' }] : []),
        { action: 'confirm', label: primary?.label ?? 'Graj' },
        { action: 'x', label: activeFilters.length ? `Filtry (${activeFilters.length})` : 'Filtry' },
        { action: 'y', label: 'Opcje gry' },
        { action: 'ls', label: 'Szukaj' },
        { action: 'rs', label: sel && isFav(sel.id) ? 'Usuń z ulubionych' : 'Ulubiona' },
        { action: 'lb', label: 'Strona' },
        { action: 'rt', label: 'Litera' },
        { action: 'back', label: 'Wstecz' },
        { action: 'menu', label: 'Menu' }
      ]
    }
  )

  const head = (
        <div className="tv-listhead">
          <SystemLogo
            sysKey={system.key}
            display={system.display}
            hasLogo={system.logo}
            look={theme.logoStyle}
            className={steam ? 'tv-listlogo-steam' : 'tv-listlogo'}
            fallback={<h2>{system.display}</h2>}
          />
          <div className="tv-lhtext">
            <p>
              {activeFilters.length || games.length !== system.games.length
                ? `${games.length} z ${system.games.length} ${plural(system.games.length, 'gry', 'gier', 'gier')}`
                : `${games.length} ${plural(games.length, 'gra', 'gry', 'gier')}`}
            </p>
            {activeFilters.length > 0 && <p className="tv-filters-on">{activeFilters.join(' · ')}</p>}
          </div>
        </div>
  )
  const empty = <p className="tv-dim">Brak gier{activeFilters.length ? ' dla tych filtrów (X — zmień albo wyczyść)' : ''}.</p>
  const modals = (
    <>
      {options && sel && (
        <GameOptions
          game={sel}
          onClose={() => {
            // emulator, saves or download may have changed there
            for (const k of Object.keys(emuOptions)) if (k.startsWith(`${sel.id}|`)) delete emuOptions[k]
            setInfoRev((r) => r + 1)
            setOptions(false)
          }}
        />
      )}
      {filters && (
        <TvFilters system={system.display} games={system.games} steam={steam} filter={filter} onChange={setFilter} onClose={() => setFilters(false)} />
      )}
    </>
  )

  if (flow)
    return (
      <section className="tv-screen tv-games tv-games--flow">
        {sel && <TvBackdrop key={sel.id} game={sel} />}
        {head}
        {games.length ? (
          <TvCoverflow games={games} idx={Math.min(idx, games.length - 1)} onPick={(i) => (i === idx ? play() : setIdx(i))} reflection={!!theme.games.reflection} />
        ) : (
          <div className="tv-flow">{empty}</div>
        )}
        {sel && (
          // under the ribbon: the title and the description (readable, many lines) | the details in a column
          <div className="tv-flow__panel">
            <div className="tv-flow__main">
              <div className="tv-flow__title">
                <LogoTitle key={sel.id} game={sel} text={<h1>{sel.name}</h1>} />
              </div>
              <TvDesc game={sel} details={d} className="tv-flow__desc" />
            </div>
            <TvInfo game={sel} details={d} note={primary?.note} rev={infoRev} noLogo />
          </div>
        )}
        {modals}
      </section>
    )

  return (
    <section className="tv-screen tv-games">
      <div className="tv-gamelist">
        {head}
        <div className="tv-rows" ref={rowsRef}>
          {games.slice(top, top + visible).map((g, i) => (
            <TvRow
              key={g.id}
              game={g}
              sel={top + i === idx}
              fav={!!favorites?.includes(g.id)}
              asLogo={asLogo}
              onClick={() => (top + i === idx ? play() : setIdx(top + i))}
            />
          ))}
          {!games.length && empty}
        </div>
      </div>
      {sel && <TvPreview game={sel} details={d} />}
      {sel && <TvInfo game={sel} details={d} note={primary?.note} rev={infoRev} />}
      {modals}
    </section>
  )
}

function TvRow({ game, sel, fav, asLogo, onClick }: { game: Game; sel: boolean; fav: boolean; asLogo: boolean; onClick: () => void }) {
  const e = game.emu
  return (
    <div className={`tv-row ${sel ? 'sel' : ''}`} onClick={onClick}>
      {asLogo && e ? <LogoTitle key={game.id} game={game} text={<span className="t">{game.name}</span>} /> : <span className="t">{game.name}</span>}
      {e?.tags && <span className="g">{e.tags}</span>}
      <span className="ic">
        {fav && (
          <span className="tv-tag f" title="Ulubiona">
            <Icon name="starFilled" />
          </span>
        )}
        {e && e.discs > 1 && (
          <span className="tv-tag" title={`${e.discs} płyty`}>
            <Icon name="disc" /> {e.discs}
          </span>
        )}
        {e?.versions && <span className="tv-tag">{versionCountLabel(e.versions.length)}</span>}
        {e?.pinned && <span className="tv-tag p">na dysku</span>}
        {e?.copying && <span className="tv-tag d">pobieranie</span>}
        {e ? e.cached && <span className="tv-tag c">lokalnie</span> : game.installed && <span className="tv-tag c">zainstalowana</span>}
        {game.running && <span className="tv-tag d">w grze</span>}
      </span>
    </div>
  )
}

/** EmuStart's "Tytuły gier jako logo" (Ustawienia → Biblioteka EmuStart → Tryb TV) */
function useGamesLogo(): boolean {
  const [asLogo, setAsLogo] = useState(false)
  // re-read after a settings change (the library snapshot changes with it)
  const emuSnap = useStore((s) => s.snapshot?.emustart)
  useEffect(() => {
    if (emuSnap?.engine !== 'ready') return
    void api()
      .emustart.options()
      .then((o) => setAsLogo(o.gamesLogo))
      .catch(() => undefined)
  }, [emuSnap])
  return asLogo
}

/** The game's logo instead of its title; the title stays until the logo has loaded (and when there is none). */
function LogoTitle({ game, text }: { game: Game; text: ReactNode }) {
  const [ok, setOk] = useState(false)
  return (
    <>
      {!ok && text}
      <span className={`tv-logo ${ok ? '' : 'is-wait'}`}>
        <Art gameId={game.id} name={game.name} kind="logo" className="tv-logo__img" fallback="none" eager layout="tv" onState={setOk} />
      </span>
    </>
  )
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

/** Height for the cover and the screenshot so that both, at their shapes, fit the preview's width side by side. */
function useMediaFit(boxRatio: number, snapRatio: number): { ref: (el: HTMLDivElement | null) => void; h: number } {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  // the width is read at render; the observer only renders again when it changes (window, look editor)
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!el) return
    const ro = new ResizeObserver(() => setTick((t) => t + 1))
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  const width = el?.clientWidth ?? 0
  if (!el || !width) return { ref: setEl, h: 0 }
  const cs = getComputedStyle(el)
  const v = cs.getPropertyValue('--tv-media-h').trim()
  const full = v.endsWith('vh') ? (parseFloat(v) * window.innerHeight) / 100 : parseFloat(v) || 300 // the layout's media height
  const gap = parseFloat(cs.columnGap) || 0
  const capBox = 0.3 * window.innerWidth // the cover is at most 30vw wide (wider ones fit inside it)
  const rSnap = Math.min(snapRatio, 16 / 9)
  const room = width - gap // cover | screenshot side by side (the details are below)
  let h = boxRatio + rSnap > 0 ? room / (boxRatio + rSnap) : full
  if (h * boxRatio > capBox) h = rSnap > 0 ? (room - capBox) / rSnap : full
  // never taller than the preview itself: the description below keeps at least 30% of it
  const room_h = el.clientHeight > 0 ? el.clientHeight * 0.7 : full
  h = Math.min(full, h, room_h)
  return { ref: setEl, h: Math.max(0, Math.floor(h)) }
}

function TvPreview({ game, details: dr }: { game: Game; details: DetailsResult | null }) {
  const [boxOk, setBoxOk] = useState(true)
  const [snapOk, setSnapOk] = useState(true)
  // the cover and the screenshot share one height (their own shapes); when both do not fit side by
  // side at the layout's height, they get lower together
  const [snapRatio, setSnapRatio] = useState(4 / 3)
  const [boxRatio, setBoxRatio] = useState(3 / 4)
  const fitH = useMediaFit(boxOk ? boxRatio : 0, snapOk ? snapRatio : 0)
  useEffect(() => {
    setBoxOk(true)
    setSnapOk(true)
  }, [game.id])
  return (
    <div className="tv-preview" ref={fitH.ref} style={fitH.h ? { ['--tv-media-fit' as string]: `${fitH.h}px` } : undefined}>
      <div className="tv-box">
        {boxOk ? (
          <Art key={`b-${game.id}`} gameId={game.id} name={game.name} kind="grid" className="tv-boxart" fallback="none" eager layout="tv" onState={setBoxOk} onRatio={setBoxRatio} />
        ) : (
          <div className="tv-noart">brak okładki</div>
        )}
      </div>
      <div className="tv-snap" style={{ ['--ar' as string]: snapRatio }}>
        {snapOk && (
          <Art
            key={`s-${game.id}`}
            gameId={game.id}
            name={game.name}
            kind="hero"
            className="tv-snapart"
            fallback="none"
            eager
            layout="tv"
            onState={setSnapOk}
            onRatio={setSnapRatio}
          />
        )}
      </div>
      <TvDesc game={game} details={dr} />
    </div>
  )
}

/** The game's description; longer than its box it scrolls slowly after a pause (useDescScroll). */
function TvDesc({ game, details: dr, className }: { game: Game; details: DetailsResult | null; className?: string }) {
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
        {game.source !== 'emustart' && !desc.length && <p>Gra z biblioteki Steam.</p>}
      </div>
    </div>
  )
}

/** The selected game's background art over the whole screen (ribbon layout), faded into the theme. */
function TvBackdrop({ game }: { game: Game }) {
  return (
    <div className="tv-backdrop" aria-hidden="true">
      <Art gameId={game.id} name={game.name} kind="hero" fallback="none" eager layout="tv" />
    </div>
  )
}

/** EmuStart's own data of the shown game (emulator, saves, bytes on this PC) — after a short pause on it */
const emuOptions: Record<string, EmuGameOptions> = {}
function useEmuOptions(game: Game, rev: number): EmuGameOptions | null {
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

function saveLine(o: EmuGameOptions): string {
  const s = o.sync
  const st = s.state === 'synced' ? 'zsynchronizowane' : s.state === 'pending' ? 'czekają na wysłanie' : 'jeszcze nie synchronizowane'
  return `${o.states ? `${o.states} ${plural(o.states, 'stan', 'stany', 'stanów')} · ` : ''}${st}`
}

/**
 * The bar at the bottom of the screen, across its whole width: the game's logo on the left (always —
 * its title when there is none), the details next to it in a few lines.
 */
function TvInfo({ game, details: dr, note, rev, noLogo }: { game: Game; details: DetailsResult | null; note?: string; rev: number; noLogo?: boolean }) {
  const d = dr?.ok ? dr.details : undefined
  const e = game.emu
  const status = e
    ? e.copying
      ? 'pobieranie…'
      : e.pinned
        ? 'zachowana na dysku'
        : e.cached
          ? 'pobrana'
          : 'na serwerze'
    : stateLabel(game)
  const o = useEmuOptions(game, rev)
  const size = e ? e.size : game.sizeOnDisk
  const local = o?.local ?? 0
  const rows: [string, string | undefined][] = [
    ['Status', status],
    ['Oznaczenia', e?.tags],
    ['System', o?.system || (e ? e.system : undefined) || d?.platform],
    ['Rozmiar', formatBytes(size)],
    ['Pobrano', e && local > 0 && size && local < size ? `${formatBytes(local)} z ${formatBytes(size)}` : undefined],
    ['Ostatnio', formatLastPlayed(game.lastPlayed) ?? 'nigdy'],
    ['Czas gry', formatPlaytime(game.playtimeMinutes) ?? '–'],
    ['Uruchomienia', d?.plays ? String(d.plays) : undefined],
    ['Gatunek', d?.genres?.join(', ') || e?.genre],
    ['Rok', d?.releaseDate || e?.year],
    ['Producent', d?.developers?.join(', ')],
    ['Wydawca', d?.publishers?.join(', ')],
    ['Gracze', d?.players],
    ['Kooperacja', d?.coop === undefined ? undefined : d.coop ? 'tak' : 'nie'],
    ['Wiek', d?.esrb],
    ['Ocena LaunchBox', d?.rating ? `★ ${d.rating.toFixed(1).replace('.', ',')}/5${d.ratingCount ? ` · ${d.ratingCount} ${plural(d.ratingCount, 'głos', 'głosy', 'głosów')}` : ''}` : undefined],
    ['Krytycy', d?.criticScore ? `Metacritic ${d.criticScore}` : undefined],
    ['Recenzje Steam', d?.playerScore !== undefined && d.playerReviews ? `${d.playerScore}% pozytywnych · ${d.playerReviews.toLocaleString('pl-PL')}` : undefined],
    ['Wydanie', d?.releaseType && !/^released$/i.test(d.releaseType) ? d.releaseType : undefined],
    ['Emulator', o ? o.emulator.label || 'brak emulatora' : undefined],
    ['Zapisy', o ? saveLine(o) : undefined],
    ['Płyty', e && e.discs > 1 ? String(e.discs) : undefined],
    ['Wersje', e?.versions ? `${e.versions.length} — wybór w opcjach gry` : undefined]
  ]
  return (
    <div className="tv-info">
      {!noLogo && (
        <div className="tv-info__logo">
          <LogoTitle key={game.id} game={game} text={<h1>{game.name}</h1>} />
        </div>
      )}
      <div className="tv-info__body">
        <dl>
          {rows
            .filter((r): r is [string, string] => !!r[1])
            .map(([k, v]) => (
              <div key={k} className="tv-dlrow">
                <dt>{k}</dt>
                <dd className={k === 'Status' ? (e?.cached || game.installed ? 'st-c' : 'st-n') : undefined}>{v}</dd>
              </div>
            ))}
        </dl>
        {note && <p className="tv-note">{note}</p>}
      </div>
    </div>
  )
}
