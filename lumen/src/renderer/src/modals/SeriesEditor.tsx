import { useEffect, useMemo, useRef, useState } from 'react'
import type { Game } from '@shared/types'
import { groupsOnScope, moveInSeries, seriesKey, seriesMembers, seriesOf, seriesOnScope, yearOf, type SeriesPref, type SeriesPrefs } from '@shared/series'
import { api, attempt, useStore } from '../store'
import { focusFirst } from '../nav/engine'
import { Modal } from '../components/Modal'
import { TextField } from '../components/TextField'

// „Opcje gry” → Seria (pulpit, tryb TV): grupa → seria → gry tej platformy (decyzje 2026-11-16: seria nie miesza
// platform, tylko gry, które masz, jedna pozycja na grę), poprawka kolejności — wcześniej / później, dołączenie do
// istniejącej serii z listy z wyszukiwaniem albo nowej („Utwórz serię”), grupa tak samo, „nie należy do serii”,
// powrót do rozpoznawania. Wybór gracza zostaje w preferencjach Lumena (prefs.series, shared/series.ts).

/** Wiersz „Seria” w opcjach gry: nazwa i miejsce, np. „Wing Commander · 2 z 4”. */
export function seriesSummary(game: Game, all: Game[], prefs: SeriesPrefs | undefined): string {
  if (prefs?.[game.id]?.none) return 'nie należy do serii'
  const s = seriesOf(game, prefs)
  const members = onePerGame(seriesMembers(game, all, prefs), game.id)
  if (!s || members.length < 2) return 'brak — można dołączyć do serii'
  return `${s.name} · ${members.findIndex((x) => x.games.some((g) => g.id === game.id)) + 1} z ${members.length}`
}

/** tytuł bez znaczków i dopisków w nawiasach (regiony: „(USA)”, „(Europe)”) — wersje jednej gry; nie scala różnych
 * gier o podobnej nazwie („Sid Meier's Pirates!” i „Pirates!” zostają osobno) */
const versionKey = (name: string): string =>
  name
    .replace(/[™®©]/g, '')
    .replace(/\s*[([][^)\]]*[)\]]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

/** Wersje jednej gry (regiony, kopie na serwerze) jako jedna pozycja — ta z opcji gry na przedzie. */
function onePerGame(members: Game[], current: string): { games: Game[]; lead: Game }[] {
  const by = new Map<string, Game[]>()
  for (const g of members) {
    const k = versionKey(g.name)
    const arr = by.get(k)
    if (arr) arr.push(g)
    else by.set(k, [g])
  }
  return [...by.values()].map((games) => ({ games, lead: games.find((g) => g.id === current) ?? games[0] }))
}

/** Skąd jest gra: Steam, GOG, system emulatora (pobrana / na serwerze), skrót. */
function sourceOf(g: Game): string {
  if (g.source === 'steam') return g.installed ? 'Steam · zainstalowana' : 'Steam'
  if (g.source === 'gog') return g.installed ? 'GOG · zainstalowana' : 'GOG'
  if (g.source === 'xbox') return g.installed ? 'Xbox · zainstalowana' : g.xbox?.gamePass && !g.xbox.owned ? 'Game Pass' : 'Xbox'
  if (g.source === 'emustart') return `${g.emu?.system ?? g.emu?.es ?? 'EmuStart'}${g.emu?.cached ? ' · pobrana' : ''}`
  return g.source === 'shortcut' ? 'skrót Steam' : g.source
}

type Picking = 'series' | 'group' | null

export function SeriesEditor({ game, onClose }: { game: Game; onClose: () => void }) {
  const series = useStore((s) => s.prefs?.series)
  const all = useStore((s) => s.snapshot?.games)
  const [picking, setPicking] = useState<Picking>(null)
  // gra przesuwana przyciskami „Wcześniej / Później” — wybierana na liście serii (na początku: ta z opcji gry)
  const [picked, setPicked] = useState(game.id)
  const listRef = useRef<HTMLDivElement>(null)
  const igdbRev = useStore((s) => s.igdbRev) // serie z IGDB (osobny kanał) — lista od nowa po zmianie
  const members = useMemo(() => seriesMembers(game, all ?? [game], series), [game, all, series, igdbRev]) // eslint-disable-line react-hooks/exhaustive-deps
  const items = useMemo(() => onePerGame(members, game.id), [members, game.id])
  const own = series?.[game.id]
  const s = seriesOf(game, series)
  const inSeries = !!s && items.length > 1
  const pickItem = items.find((x) => x.games.some((g) => g.id === picked)) ?? items[0]

  useEffect(() => {
    const t = setTimeout(() => listRef.current && focusFirst(listRef.current), 0)
    return () => clearTimeout(t)
  }, [picking])

  const set = (changes: Record<string, SeriesPrefs[string] | null>): void => void attempt(api().prefs.setSeries(changes))
  /** zmiana jednej gry z zachowaniem reszty jej ustawień (grupa); w innej serii — bez miejsca ze starej */
  const patchOwn = (p: SeriesPref): void => set({ [game.id]: { ...own, none: undefined, ...(p.name !== undefined ? { order: undefined } : {}), ...p } })
  /** grupa nad całą serią: każda gra serii (każda wersja) dostaje ją do swoich ustawień */
  const setGroup = (group: string): void => {
    const out: SeriesPrefs = {}
    for (const g of inSeries ? members : [game]) out[g.id] = { ...series?.[g.id], none: undefined, group }
    set(out)
  }
  // Przyciski nie wyłączają się na krańcu listy: wyłączony przycisk oddawał fokus sąsiedniemu („Później”) i kolejne
  // naciśnięcie przesuwało grę z powrotem — gry zamieniały się w pętli (zgłoszenie 2026-11-16).
  const move = (dir: -1 | 1): void => {
    // wersje jednej gry przesuwane razem: kolejność pozycji, potem każda wersja dostaje miejsce swojej pozycji
    const leads = items.map((x) => x.lead)
    const next = moveInSeries(leads, pickItem.lead.id, dir, series)
    if (!next) return
    const out: SeriesPrefs = {}
    for (const it of items) for (const g of it.games) out[g.id] = { ...series?.[g.id], order: next[it.lead.id]?.order }
    set(out)
  }

  if (picking) {
    return (
      <Picker
        kind={picking}
        game={game}
        all={all ?? [game]}
        prefs={series}
        current={picking === 'series' ? s?.name : s?.group}
        onPick={(name) => {
          if (picking === 'series') patchOwn({ name })
          else setGroup(name)
          setPicking(null)
        }}
        onClose={() => setPicking(null)}
      />
    )
  }

  const rows: { key: string; label: string; value?: string; act?: () => void; mark?: boolean; dim?: boolean }[] = [
    ...(inSeries
      ? [
          { key: 'up', label: 'Wcześniej w serii', value: pickItem.lead.name, act: () => move(-1) },
          { key: 'down', label: 'Później w serii', value: pickItem.lead.name, act: () => move(1) }
        ]
      : []),
    { key: 'join', label: inSeries ? 'Inna seria…' : 'Dołącz do serii…', value: 'wybierz z listy albo utwórz nową', act: () => setPicking('series') },
    { key: 'group', label: 'Grupa…', value: s?.group ?? 'brak — np. „Dungeons & Dragons” nad kilkoma seriami', act: () => setPicking('group') },
    ...(own?.none ? [] : [{ key: 'none', label: 'Nie należy do serii', act: () => set({ [game.id]: { none: true } }) }]),
    ...(own ? [{ key: 'auto', label: 'Rozpoznawaj sam', value: 'bez Twoich zmian dla tej gry', act: () => set({ [game.id]: null }) }] : []),
    ...(inSeries
      ? items.map((it, k) => {
          const y = it.games.map((g) => yearOf(g)).find((v) => v !== undefined)
          const more = it.games.length > 1 ? ` · wersji: ${it.games.length}` : ''
          return {
            key: `g:${it.lead.id}`,
            label: `${k + 1}. ${it.lead.name}`,
            value: `${y ? `${y} · ` : ''}${sourceOf(it.lead)}${more}`,
            mark: it === pickItem,
            act: () => setPicked(it.lead.id)
          }
        })
      : [])
  ]

  return (
    <Modal
      title={`Seria — ${game.name}`}
      onClose={onClose}
      wide
      className="gopt"
      hints={[
        { action: 'confirm', label: 'Wybierz' },
        { action: 'back', label: 'Wstecz' }
      ]}
    >
      <p className="details__muted">
        {inSeries
          ? `${s!.group ? `${s!.group} → ` : ''}${s!.name}: gry tej platformy stoją razem na listach po tytule, w tej kolejności. Wybierz grę z listy (▸), potem „Wcześniej / Później w serii”.`
          : 'Ta gra nie stoi w żadnej serii.'}
      </p>
      <div className="gopt__list" ref={listRef}>
        {rows.map((r) => (
          <button
            key={r.key}
            className={'gopt__row' + (r.mark ? ' is-current' : '')}
            data-nav={r.act ? true : undefined}
            disabled={!r.act}
            onClick={r.act}
          >
            <span className="gopt__label">{r.mark ? `▸ ${r.label}` : r.label}</span>
            {r.value && <span className="gopt__value">{r.value}</span>}
          </button>
        ))}
      </div>
    </Modal>
  )
}

/** Lista serii (albo grup) tej platformy z wyszukiwaniem i „Utwórz …” — bez wychodzenia z okna. */
function Picker({
  kind,
  game,
  all,
  prefs,
  current,
  onPick,
  onClose
}: {
  kind: 'series' | 'group'
  game: Game
  all: Game[]
  prefs: SeriesPrefs | undefined
  current?: string
  onPick: (name: string) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const options = useMemo(
    () =>
      kind === 'series'
        ? seriesOnScope(game, all, prefs).map((x) => ({ name: x.name, value: `${x.count} gier${x.group ? ` · ${x.group}` : ''}` }))
        : groupsOnScope(game, all, prefs).map((name) => ({ name, value: '' })),
    [kind, game, all, prefs]
  )
  const qk = seriesKey(q)
  const shown = qk ? options.filter((o) => seriesKey(o.name).includes(qk)) : options
  const exact = qk && options.some((o) => seriesKey(o.name) === qk)

  useEffect(() => {
    const t = setTimeout(() => listRef.current && focusFirst(listRef.current), 0)
    return () => clearTimeout(t)
  }, [])

  const what = kind === 'series' ? 'serię' : 'grupę'
  return (
    <Modal
      title={kind === 'series' ? `Seria dla: ${game.name}` : `Grupa dla: ${game.name}`}
      onClose={onClose}
      wide
      className="gopt"
      hints={[
        { action: 'confirm', label: 'Wybierz' },
        { action: 'back', label: 'Wstecz' }
      ]}
    >
      <div ref={listRef}>
        <TextField label={`Szukaj albo nazwij nową ${what}`} placeholder={`Szukaj albo nazwij nową ${what}…`} value={q} onChange={setQ} onSubmit={(v) => v.trim() && onPick(v.trim())} />
        <div className="gopt__list">
          {q.trim() && !exact && (
            <button className="gopt__row" data-nav onClick={() => onPick(q.trim())}>
              <span className="gopt__label">{kind === 'series' ? `Utwórz serię „${q.trim()}”` : `Utwórz grupę „${q.trim()}”`}</span>
              <span className="gopt__value">i przypisz do tej gry</span>
            </button>
          )}
          {shown.slice(0, 200).map((o) => (
            <button key={o.name} className={'gopt__row' + (o.name === current ? ' is-current' : '')} data-nav onClick={() => onPick(o.name)}>
              <span className="gopt__label">{o.name === current ? `▸ ${o.name}` : o.name}</span>
              {o.value && <span className="gopt__value">{o.value}</span>}
            </button>
          ))}
          {!shown.length && !q.trim() && <p className="details__muted">Na tej platformie nie ma jeszcze {kind === 'series' ? 'serii' : 'grup'} — wpisz nazwę, żeby utworzyć.</p>}
        </div>
      </div>
    </Modal>
  )
}
