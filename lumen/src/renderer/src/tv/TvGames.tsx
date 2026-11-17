import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { DetailsResult, Game } from '@shared/types'
import { api, askText, attempt, useStore } from '../store'
import { useActions } from '../nav/input'
import { Art } from '../components/Art'
import { Icon } from '../components/Icon'
import { SystemLogo } from './SystemLogo'
import { runPrimary, usePrimaryAction } from '../lib/primary'
import { plural, versionCountLabel } from '../lib/format'
import type { TvSystem } from './data'
import { TvFilters } from './TvFilters'
import { useRatings } from './ratings'
import { useFacts } from './facts'
import { activeParts, apply, loadFilter, needsFacts, saveFilter, type Filter } from './filters'
import { useLook } from './look'
import { listTop } from './listWindow'
import { letterJump } from './letters'
import { placedSeriesKeys } from '@shared/series'
import { TvCoverflow } from './TvCoverflow'
import type { TvTheme } from './themes'
import { LogoTitle, TvBackdrop, TvSummary, stateTag, useDetails, usePrefetchLogos } from './gameParts'
import { TvGamePage } from './TvGamePage'

// Game list of one system (EmuStart look): titles on the left, cover | details | screenshot on the
// right, the game's logo and one line about it below. A opens the game's page (TvGamePage: actions, description, facts,
// "Opcje gry"); X starts the game at once (the same main action as the desktop details, usePrimaryAction);
// Y — filters. View is not used: View+Start switches the interface.


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
  // the player's choice for this group (Menu → Układ listy), else the theme's
  const chosen = useStore((s) => s.settings?.tvLayouts?.[system.key])
  const layout = chosen ?? theme.games.layout
  // both ribbons (the 3D one and the flat row of posters) move left / right and go round the list
  const flow = layout !== 'list'
  const posters = layout === 'posters'
  const favorites = useStore((s) => s.prefs?.favorites)
  const opened = useStore((s) => s.uiSelection)
  // "installed" (Steam, GOG, PC groups) vs "in the game cache" (EmuStart platforms)
  const steam = !system.es
  // EmuStart's filters, kept per system (X); search (L3) is the filter's first field
  const [filter, setFilterState] = useState<Filter>(() => loadFilter(system.key))
  const setFilter = (f: Filter): void => {
    setFilterState(f)
    saveFilter(system.key, f)
    setIdx(0)
  }
  const [filters, setFilters] = useState(false)
  // the game's page over the list (A), by the game's id — not the list position: a filter or the order can change
  // under the open page (unfavouriting in Ulubione, a launch re-sorting „ostatnio grane”) and it keeps its game
  const [pageId, setPageId] = useState<string | null>(null)
  // a group built from a state (Ulubione) can drop the game — then it comes from the whole library
  const library = useStore((s) => s.snapshot?.games)
  const pageGame = pageId ? (system.games.find((g) => g.id === pageId) ?? library?.find((g) => g.id === pageId) ?? null) : null
  const gamePage = !!pageGame
  const isFav = (id: string): boolean => !!favorites?.includes(id)
  const ratings = useRatings(system.games, filter.sort)
  const { games: known, missing } = useFacts(system.games, filters || needsFacts(filter))
  const games = useMemo(() => apply(known, filter, isFav, ratings), [known, filter, favorites, ratings]) // eslint-disable-line react-hooks/exhaustive-deps
  const activeFilters = activeParts(filter, steam)
  // the game selected on the desktop, found in the list as shown (filters and order applied)
  const [idx, setIdx] = useState(() => Math.max(0, games.findIndex((g) => g.id === opened)))
  const sel = games[Math.min(idx, games.length - 1)]
  // tło całego ekranu (wstęga): dopiero gdy wybór stanie na ~350 ms — przy przytrzymanym kierunku nie wczytuje się
  // tło każdej mijanej gry (pliki po kilka MB zatrzymywały przewijanie gier Steam; ślad z sesji gracza)
  const [backdrop, setBackdrop] = useState(sel)
  useEffect(() => {
    const t = setTimeout(() => setBackdrop(sel), 350)
    return () => clearTimeout(t)
  }, [sel?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  // logo sąsiednich gier do pamięci, gdy wybór stoi: krok w bok pokazuje logo od razu (TvSummary, wiersze z logo)
  usePrefetchLogos(games, Math.min(idx, games.length - 1), backdrop?.id === sel?.id) // jak `sel`: po zawężeniu listy idx bywa poza nią
  // wstęga (Horyzont): pozycja bez modulo — rośnie / maleje z każdym krokiem, więc wstęga kręci się bez końca, bez
  // przeskoku na początek, także przy jednej grze; gra = pozycja modulo długość listy (flowWindow)
  const [pos, setPos] = useState(idx)
  useEffect(() => {
    // wybór inaczej niż krokiem (skok o stronę, litera, kliknięcie, filtr): najkrótszą drogą do tej gry
    const n = games.length
    if (!n) return
    setPos((p) => {
      const m = ((p % n) + n) % n
      if (m === idx) return p
      let d = idx - m
      if (d > n / 2) d -= n
      if (d < -n / 2) d += n
      return p + d
    })
  }, [idx, games.length])
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
  // one step goes round the list: past the last game to the first and back
  const step = (d: 1 | -1): boolean => {
    if (!games.length) return true
    if (flow) setPos((p) => p + d)
    setIdx((Math.min(idx, games.length - 1) + d + games.length) % games.length)
    return true
  }
  // litera gry w bloku serii = litera serii, pod którą lista ją postawiła (shared/series.ts placedSeriesKeys — klucze
  // z tego samego arrangeSeries, które ułożyło grupę); tylko w kolejności po tytule — inne sortowanie rozrzuca serie.
  // Z pełnej listy grupy, bo filtr zostawia grę na miejscu bloku, nawet gdy z jej serii nic więcej nie zostało
  const jumpLetter = (dir: 1 | -1): boolean => {
    if (!sel) return true
    const keys = filter.sort === 'title' ? placedSeriesKeys(system.games) : undefined
    return go(letterJump(games, idx, dir, keys && ((g) => keys.get(g.id))))
  }
  const openPage = (): boolean => {
    if (sel) setPageId(sel.id)
    return true
  }
  const play = (): boolean => {
    runPrimary(primary, busy)
    return true
  }

  useActions(
    {
      // column: up / down; ribbon: left / right (the other pair does nothing, so nothing jumps)
      up: () => (flow ? true : step(-1)),
      down: () => (flow ? true : step(1)),
      left: () => (flow ? step(-1) : true),
      right: () => (flow ? step(1) : true),
      lb: () => go(idx - page),
      rb: () => go(idx + page),
      lt: () => jumpLetter(-1),
      rt: () => jumpLetter(1),
      confirm: openPage,
      x: play,
      y: () => {
        setFilters(true)
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
      enabled: active && !filters && !gamePage,
      hints: [
        ...(flow ? [{ action: 'left' as const, label: 'Gra' }] : []),
        { action: 'confirm', label: 'Szczegóły' },
        { action: 'x', label: primary?.label ?? 'Graj' },
        { action: 'y', label: activeFilters.length ? `Filtry (${activeFilters.length})` : 'Filtry' },
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
            rev={system.logoRev}
            pixel={system.logoPixel}
            plate={!!theme.logoPlate}
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
  const empty = <p className="tv-dim">Brak gier{activeFilters.length ? ' dla tych filtrów (Y — zmień albo wyczyść)' : ''}.</p>
  const modals = (
    <>
      {pageGame && (
        <TvGamePage
          key={pageGame.id}
          game={pageGame}
          onMenu={onMenu}
          onBack={() => {
            // back on the game whose page it was (when it is still on the list)
            const i = games.findIndex((g) => g.id === pageGame.id)
            if (i >= 0) setIdx(i)
            setPageId(null)
          }}
        />
      )}
      {filters && (
        <TvFilters system={system.display} games={known} steam={steam} filter={filter} missing={missing} onChange={setFilter} onClose={() => setFilters(false)} />
      )}
    </>
  )

  if (flow)
    return (
      <section className={`tv-screen tv-games tv-games--flow ${posters ? 'tv-games--posters' : ''}`}>
        {backdrop && <TvBackdrop key={backdrop.id} game={backdrop} />}
        {head}
        {/* posters: the game's logo and one line about it stand above the row, over its background */}
        {posters && sel && <TvSummary game={sel} details={d} note={primary?.note} className="tv-posters__summary" />}
        {games.length ? (
          <TvCoverflow
            games={games}
            pos={pos}
            animate={backdrop?.id === sel?.id}
            onPick={(i) => (i === idx ? openPage() : setIdx(i))}
            reflection={!posters && !!theme.games.reflection}
            flat={posters}
          />
        ) : (
          <div className="tv-flow">{empty}</div>
        )}
        {/* the ribbon: the logo and one line about the game below it (the description and every detail: A) */}
        {!posters && sel && <TvSummary game={sel} details={d} note={primary?.note} className="tv-flow__summary" />}
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
              onClick={() => (top + i === idx ? openPage() : setIdx(top + i))}
            />
          ))}
          {!games.length && empty}
        </div>
      </div>
      {sel && <TvPreview game={sel} details={d} note={primary?.note} />}
      {modals}
    </section>
  )
}

const TAG_CLASS = { run: 'd', dl: 'd', keep: 'p', ok: 'c' } as const

function TvRow({ game, sel, fav, asLogo, onClick }: { game: Game; sel: boolean; fav: boolean; asLogo: boolean; onClick: () => void }) {
  const e = game.emu
  const tag = stateTag(game)
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
        {/* one state tag: the most important one (playing → downloading → kept → here) */}
        {tag && <span className={`tv-tag ${TAG_CLASS[tag.kind]}`}>{tag.label}</span>}
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

function TvPreview({ game, details: dr, note }: { game: Game; details: DetailsResult | null; note?: string }) {
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
      {/* below the art: the logo and one line about the game (the description and every detail: A — the game's page) */}
      <TvSummary game={game} details={dr} note={note} className="tv-preview__summary" />
    </div>
  )
}
