import { useEffect, useMemo, useRef, useState } from 'react'
import type { Game } from '@shared/types'
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
import { activeParts, apply, loadFilter, saveFilter, type Filter as GameFilter } from '../tv/filters'

// One library view (a tab in the top bar, or a subgroup chosen with the chips under its title): its games
// as a Steam-style poster grid. Groups and chips come from the shared library hierarchy (lib/nav.ts).

/** What a group screen shows: a subgroup of the library hierarchy (PC › GOG, Konsole › PS2, a collection…) */
export interface GroupView {
  /** stable id (view settings and filters are kept per view) */
  key: string
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
type Sort = 'name' | 'recent' | 'added' | 'playtime'

const FILTERS: [Filter, string][] = [
  ['all', 'Wszystkie'],
  ['installed', 'Zainstalowane'],
  ['notInstalled', 'Niezainstalowane']
]
const SORTS: [Sort, string][] = [
  ['name', 'Nazwa'],
  ['recent', 'Ostatnio grane'],
  ['added', 'Nowo dodane'],
  ['playtime', 'Czas gry']
]

const viewKey = (catId: string): string => `lumen.group.${catId}`

function loadView(catId: string): { filter: Filter; sort: Sort } {
  try {
    const v = JSON.parse(localStorage.getItem(viewKey(catId)) ?? '{}')
    return { filter: v.filter ?? 'all', sort: v.sort ?? 'name' }
  } catch {
    return { filter: 'all', sort: 'name' }
  }
}

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
  const initial = useMemo(() => loadView(view.key), [view.key])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>(initial.filter)
  const [sort, setSort] = useState<Sort>(initial.sort)
  const searchRef = useRef<HTMLInputElement>(null)
  // the TV layout's filter window (genre, decade, players, region, developer…), kept per group
  const [more, setMoreState] = useState<GameFilter>(() => loadFilter(`group:${view.key}`))
  useEffect(() => setMoreState(loadFilter(`group:${view.key}`)), [view.key])
  useEffect(() => {
    const v = loadView(view.key)
    setFilter(v.filter)
    setSort(v.sort)
  }, [view.key])
  const setMore = (f: GameFilter): void => {
    setMoreState(f)
    saveFilter(`group:${view.key}`, f)
  }
  const [filtersOpen, setFiltersOpen] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem(viewKey(view.key), JSON.stringify({ filter, sort }))
    } catch {
      /* ignore */
    }
  }, [view.key, filter, sort])

  const all = view.games
  // emulator shortcuts are always installed — the install filter only matters when Steam games are in the group
  const hasInstallState = all.some((g) => g.source !== 'shortcut')
  const effectiveFilter: Filter = hasInstallState ? filter : 'all'
  const has = {
    recent: all.some((g) => g.lastPlayed),
    added: all.some((g) => g.addedAt),
    playtime: all.some((g) => g.playtimeMinutes !== undefined)
  }

  const noMeta = !all.some((g) => g.emu)
  const moreParts = activeParts(more, noMeta)
  const ratings = useRatings(all, more.sort)
  const games = useMemo(() => {
    const isFav = (id: string): boolean => prefs.favorites.includes(id)
    // the window's order wins when set; otherwise the group's own (View)
    let list = apply(all, more, isFav, ratings)
    if (effectiveFilter === 'installed') list = list.filter((g) => g.installed)
    if (effectiveFilter === 'notInstalled') list = list.filter((g) => !g.installed)
    const q = norm(query.trim())
    if (q) list = list.filter((g) => norm(g.name).includes(q))
    if (more.sort !== 'title') return list
    const byName = (a: Game, b: Game): number => a.sortName.localeCompare(b.sortName, 'pl')
    const sorted = [...list]
    if (sort === 'name') sorted.sort(byName)
    if (sort === 'recent') sorted.sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0) || byName(a, b))
    if (sort === 'added') sorted.sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0) || byName(a, b))
    if (sort === 'playtime') sorted.sort((a, b) => (b.playtimeMinutes ?? -1) - (a.playtimeMinutes ?? -1) || byName(a, b))
    return sorted
  }, [all, effectiveFilter, query, sort, more, prefs.favorites, ratings])

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
    const avail = SORTS.filter(([s]) => s === 'name' || has[s as keyof typeof has])
    const i = avail.findIndex(([s]) => s === sort)
    setSort(avail[(i + 1) % avail.length][0])
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
          Sortuj: <strong>{SORTS.find(([s]) => s === sort)![1]}</strong>
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
        <TvFilters system={view.title} games={all} steam={noMeta} filter={more} onChange={setMore} onClose={() => setFiltersOpen(false)} />
      )}
    </div>
  )
}
