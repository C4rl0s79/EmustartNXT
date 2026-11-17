import { useEffect, useMemo, useRef, useState } from 'react'
import type { Game } from '@shared/types'
import { compareText } from '@shared/libraryNav'
import { arrangeSeries } from '@shared/series'
import { useStore } from '../store'
import { useActions } from '../nav/input'
import { focusEl, focusFirst } from '../nav/engine'
import { TextField } from '../components/TextField'
import { LibraryNotice } from '../components/LibraryNotice'
import { toggleFavoriteOfFocused, VirtualPosterGrid } from '../components/PosterGrid'
import { gameCountLabel } from '../lib/format'
import { Glyph } from '../components/Hints'
import { Icon } from '../components/Icon'
import { EmuNotice } from '../components/EmuNotice'
import { TvFilters } from '../tv/TvFilters'
import { useRatings } from '../tv/ratings'
import { useFacts } from '../tv/facts'
import { activeParts, apply, loadFilter, needsFacts, saveFilter, SORT, type Filter as GameFilter } from '../tv/filters'

// One library view (a tab in the top bar, or a subgroup chosen with the chips under its title): its games
// as a Steam-style poster grid. Groups and chips come from the shared library hierarchy (lib/nav.ts).

/** What a group screen shows: a subgroup of the library hierarchy (PC › GOG, Konsole › PS2, a collection…) */
export interface GroupView {
  /** stable id of the view */
  key: string
  /** id of the group's filters and order — the same in the TV layout (tv/filters.ts: filterId) */
  filterId: string
  title: string
  games: Game[]
  badge?: string
  /** notice under the toolbar: Steam account library / EmuStart engine state */
  notice?: 'steam' | 'emu'
  emptyHint?: string
  /** second level: the group's subgroups (Wszystkie, Steam, GOG… / platforms) */
  chips?: { id: string; label: string; count: number }[]
  chip?: string
  onChip?: (id: string) => void
  /** quick-access pin of the shown subgroup */
  pin?: { pinned: boolean; toggle: () => void }
}

type Filter = 'all' | 'installed' | 'notInstalled'

const FILTERS: [Filter, string][] = [
  ['all', 'Wszystkie'],
  ['installed', 'Zainstalowane'],
  ['notInstalled', 'Niezainstalowane']
]
/** the toolbar's install filter is the group filters' "show" (the same record as in the TV layout) */
const SHOW_OF: Record<Filter, GameFilter['show']> = { all: 'all', installed: 'local', notInstalled: 'notlocal' }

/** the toolbar's orders (View cycles them); other orders come from the filter window */
const SORTS: [GameFilter['sort'], string][] = [
  ['title', 'Nazwa'],
  ['last', 'Ostatnio grane'],
  ['added', 'Nowo dodane'],
  ['time', 'Czas gry']
]

const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')

export function GroupScreen({ view, active }: { view: GroupView; active: boolean }) {
  const prefs = useStore((s) => s.prefs)!
  const openDetails = useStore((s) => s.openDetails)
  const mode = useStore((s) => s.inputMode)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  // the group's filters and order (filter window, install filter, Sortuj) — one record with the TV layout
  const [more, setMoreState] = useState<GameFilter>(() => loadFilter(view.filterId))
  useEffect(() => setMoreState(loadFilter(view.filterId)), [view.filterId])
  const setMore = (f: GameFilter): void => {
    setMoreState(f)
    saveFilter(view.filterId, f)
  }
  const filter: Filter = more.show === 'local' ? 'installed' : more.show === 'notlocal' ? 'notInstalled' : 'all'
  const setFilter = (f: Filter): void => setMore({ ...more, show: SHOW_OF[f] })
  const sort = more.sort
  const [filtersOpen, setFiltersOpen] = useState(false)

  const all = view.games
  // emulator shortcuts are always installed — the install filter only matters when Steam games are in the group
  const hasInstallState = all.some((g) => g.source !== 'shortcut')
  // the install filter is shown on the toolbar, not among the active filters; without install state it does nothing
  const installShown = more.show === 'local' || more.show === 'notlocal'
  const applied: GameFilter = !hasInstallState && installShown ? { ...more, show: 'all' } : more
  const has = {
    recent: all.some((g) => g.lastPlayed),
    added: all.some((g) => g.addedAt),
    playtime: all.some((g) => g.playtimeMinutes !== undefined)
  }

  const noMeta = !all.some((g) => g.emu)
  const moreParts = activeParts(hasInstallState && installShown ? { ...more, show: 'all' } : more, noMeta)
  const ratings = useRatings(all, more.sort)
  const { games: known, missing } = useFacts(all, filtersOpen || needsFacts(more))
  const games = useMemo(() => {
    const isFav = (id: string): boolean => prefs.favorites.includes(id)
    // the same filtering and order as the TV layout; by name — with series side by side, as the library's lists
    let list = apply(known, applied, isFav, ratings)
    const q = norm(query.trim())
    if (q) list = list.filter((g) => norm(g.name).includes(q))
    if (sort !== 'title') return list
    return arrangeSeries([...list].sort((a, b) => compareText(a.sortName, b.sortName)), prefs.series)
  }, [known, applied, query, sort, prefs.favorites, prefs.series, ratings])

  const favs = useMemo(() => new Set(prefs.favorites), [prefs.favorites])

  useActions(
    {
      // The toolbar is driven by dedicated buttons only (arrows / stick stay on the games):
      // Y = search, LT/RT = install filter, View = sort.
      y: () => {
        const input = searchRef.current
        if (!input) return true
        // with a controller go straight to the on-screen keyboard; with a keyboard type into the field
        if (useStore.getState().inputMode === 'gamepad') input.dispatchEvent(new CustomEvent('lumen-osk', { bubbles: true }))
        else focusEl(input)
        return true
      },
      lt: () => {
        if (hasInstallState) cycleFilter(-1)
        return true
      },
      rt: () => {
        if (hasInstallState) cycleFilter(1)
        return true
      },
      view: () => {
        nextSort()
        return true
      },
      x: () => {
        setFiltersOpen(true)
        return true
      },
      rs: toggleFavoriteOfFocused,
      back: () => {
        if (query) {
          setQuery('')
          return true
        }
        useStore.getState().setTab('home')
        return true
      }
    },
    {
      enabled: active && !filtersOpen,
      hints: [
        { action: 'confirm', label: 'Otwórz' },
        { action: 'x', label: moreParts.length ? `Filtry (${moreParts.length})` : 'Filtry' },
        { action: 'rs', label: 'Ulubiona' },
        { action: 'y', label: 'Szukaj' },
        ...(hasInstallState ? [{ action: 'rt' as const, label: 'Filtr' }] : []),
        { action: 'view', label: 'Sortuj' },
        { action: 'rb', label: 'Grupa' },
        { action: 'back', label: query ? 'Wyczyść' : 'Start' }
      ]
    }
  )

  function nextSort(): void {
    const avail = SORTS.filter(([s]) => s === 'title' || (s === 'last' ? has.recent : s === 'added' ? has.added : has.playtime))
    const i = avail.findIndex(([s]) => s === sort)
    setMore({ ...more, sort: avail[(i + 1) % avail.length][0] })
  }
  function cycleFilter(delta: number): void {
    const i = FILTERS.findIndex(([f]) => f === filter)
    setFilter(FILTERS[(i + delta + FILTERS.length) % FILTERS.length][0])
  }

  return (
    <div className="group">
      <header className="group__head">
        <h1>{view.title}</h1>
        <span className="group__count">
          {games.length === all.length ? gameCountLabel(all.length) : `${games.length} z ${gameCountLabel(all.length)}`}
        </span>
        {view.badge && <span className="pill">{view.badge}</span>}
      </header>
      {(view.chips?.length || view.pin) && (
        // second level of the hierarchy — reached with ↑ from the first row of posters (pad, arrows) or the mouse
        <nav className="subgroups" aria-label="Podgrupy">
          {view.chips?.map((c) => (
            <button
              key={c.id}
              data-nav
              data-key={`sub-${c.id}`}
              className={`chip ${view.chip === c.id ? 'is-on' : ''}`}
              aria-pressed={view.chip === c.id}
              onClick={() => view.onChip?.(c.id)}
            >
              {c.label}
              <span className="chip__count">{c.count}</span>
            </button>
          ))}
          {view.pin && (
            <button data-nav data-key="sub-pin" className={`chip chip--pin ${view.pin.pinned ? 'is-on' : ''}`} onClick={view.pin.toggle} title="Szybki dostęp w górnym pasku i w trybie TV">
              {view.pin.pinned ? 'Odepnij' : 'Przypnij'}
            </button>
          )}
        </nav>
      )}
      <div className="toolbar">
        {mode === 'gamepad' && <Glyph action="y" />}
        <div className="toolbar__search">
          <span className="toolbar__icon" aria-hidden>
            <Icon name="search" />
          </span>
          <TextField
            inputRef={searchRef}
            nav={false}
            navKey="search"
            label={`Szukaj w grupie ${view.title}`}
            placeholder="Szukaj po nazwie…"
            value={query}
            onChange={setQuery}
            onSubmit={() => {
              const grid = searchRef.current?.closest('.group')?.querySelector<HTMLElement>('.grid')
              if (grid) focusFirst(grid)
            }}
          />
        </div>
        {hasInstallState && (
          <>
            {mode === 'gamepad' && <Glyph action="lt" />}
            <div className="segmented" role="group" aria-label="Status instalacji">
              {FILTERS.map(([f, label]) => (
                <button key={f} tabIndex={-1} className={`seg ${filter === f ? 'is-on' : ''}`} onClick={() => setFilter(f)}>
                  {label}
                </button>
              ))}
            </div>
            {mode === 'gamepad' && <Glyph action="rt" />}
          </>
        )}
        <button className={`btn btn--ghost ${moreParts.length ? 'is-on' : ''}`} tabIndex={-1} onClick={() => setFiltersOpen(true)} title={moreParts.join(' · ')}>
          {mode === 'gamepad' && <Glyph action="x" />}
          Filtry{moreParts.length ? <strong> ({moreParts.length})</strong> : ''}
        </button>
        <button className="btn btn--ghost" tabIndex={-1} onClick={nextSort}>
          {mode === 'gamepad' && <Glyph action="view" />}
          Sortuj: <strong>{SORTS.find(([s]) => s === sort)?.[1] ?? SORT[sort]}</strong>
        </button>
      </div>
      {moreParts.length > 0 && (
        <ul className="group__filters" aria-label="Aktywne filtry">
          {moreParts.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {view.notice === 'steam' && <LibraryNotice />}
      {view.notice === 'emu' && <EmuNotice />}
      {games.length ? (
        <VirtualPosterGrid key={view.key} games={games} favs={favs} onOpen={(g) => openDetails(g.id)} navGroup={`grid-${view.key}`} />
      ) : (
        <div className="empty empty--inline">
          <h2>{all.length ? 'Brak wyników' : 'Pusta grupa'}</h2>
          <p>
            {query
              ? `Żadna gra nie pasuje do „${query}”.`
              : all.length
                ? 'Żadna gra nie spełnia wybranych filtrów.'
                : (view.emptyHint ?? 'Brak gier w tej grupie.')}
          </p>
        </div>
      )}
      {filtersOpen && (
        <TvFilters system={view.title} games={known} steam={noMeta} filter={more} missing={missing} onChange={setMore} onClose={() => setFiltersOpen(false)} />
      )}
    </div>
  )
}
