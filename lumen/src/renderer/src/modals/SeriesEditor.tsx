import { useEffect, useMemo, useRef, useState } from 'react'
import type { Game } from '@shared/types'
import { moveInSeries, seriesMembers, seriesOf, yearOf, type SeriesPrefs } from '@shared/series'
import { api, attempt, useStore } from '../store'
import { focusFirst } from '../nav/engine'
import { Modal } from '../components/Modal'
import { OnScreenKeyboard } from '../components/TextField'

// „Opcje gry” → Seria (pulpit, tryb TV): gry tej serii w kolejności, w jakiej stoją na listach, i prosta poprawka —
// wcześniej / później, inna nazwa serii (dołączenie do innej), „nie należy do serii”, powrót do rozpoznawania.
// Wybór gracza zostaje w preferencjach Lumena (prefs.series, shared/series.ts).

/** Wiersz „Seria” w opcjach gry: nazwa i miejsce, np. „Wing Commander · 2 z 4”. */
export function seriesSummary(game: Game, all: Game[], prefs: SeriesPrefs | undefined): string {
  if (prefs?.[game.id]?.none) return 'nie należy do serii'
  const s = seriesOf(game, prefs)
  const members = seriesMembers(game, all, prefs)
  if (!s || members.length < 2) return 'brak — można dołączyć do serii'
  return `${s.name} · ${members.findIndex((g) => g.id === game.id) + 1} z ${members.length}`
}

export function SeriesEditor({ game, onClose }: { game: Game; onClose: () => void }) {
  const series = useStore((s) => s.prefs?.series)
  const all = useStore((s) => s.snapshot?.games)
  const [naming, setNaming] = useState(false)
  // gra przesuwana przyciskami „Wcześniej / Później” — wybierana na liście serii (na początku: ta z opcji gry)
  const [picked, setPicked] = useState(game.id)
  const listRef = useRef<HTMLDivElement>(null)
  const igdbRev = useStore((s) => s.igdbRev) // serie z IGDB (osobny kanał) — lista od nowa po zmianie
  const members = useMemo(() => seriesMembers(game, all ?? [game], series), [game, all, series, igdbRev]) // eslint-disable-line react-hooks/exhaustive-deps
  const own = series?.[game.id]
  const s = seriesOf(game, series)
  const inSeries = !!s && members.length > 1
  const pick = members.find((g) => g.id === picked) ?? game

  useEffect(() => {
    const t = setTimeout(() => listRef.current && focusFirst(listRef.current), 0)
    return () => clearTimeout(t)
  }, [])

  const set = (changes: Record<string, SeriesPrefs[string] | null>): void => void attempt(api().prefs.setSeries(changes))
  // Przyciski nie wyłączają się na krańcu listy: wyłączony przycisk oddawał fokus sąsiedniemu („Później”) i kolejne
  // naciśnięcie przesuwało grę z powrotem — gry zamieniały się w pętli (zgłoszenie 2026-11-16).
  const move = (dir: -1 | 1): void => {
    const next = moveInSeries(members, pick.id, dir, series)
    if (next) set(next)
  }

  const rows: { key: string; label: string; value?: string; act?: () => void; mark?: boolean }[] = [
    ...(inSeries
      ? [
          { label: 'Wcześniej w serii', value: pick.name, act: () => move(-1) },
          { label: 'Później w serii', value: pick.name, act: () => move(1) }
        ]
      : []),
    { label: inSeries ? 'Zmień nazwę serii…' : 'Dołącz do serii…', value: 'ta sama nazwa co inna gra — razem z nią', act: () => setNaming(true) },
    ...(own?.none ? [] : [{ label: 'Nie należy do serii', act: () => set({ [game.id]: { none: true } }) }]),
    ...(own ? [{ label: 'Rozpoznawaj z tytułu', value: 'bez Twoich zmian dla tej gry', act: () => set({ [game.id]: null }) }] : []),
    ...(inSeries
      ? members.map((g, k) => ({
          key: `g:${g.id}`,
          label: `${k + 1}. ${g.name}`,
          value: String(yearOf(g) ?? ''),
          mark: g.id === pick.id,
          act: () => setPicked(g.id)
        }))
      : [])
  ].map((r) => ({ key: r.label, ...r }))

  return (
    <>
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
            ? `${s!.name}: gry stoją razem na listach po tytule, w tej kolejności. Wybierz grę z listy (▸), potem „Wcześniej / Później w serii”.`
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
      {naming && (
        <OnScreenKeyboard
          label="Nazwa serii"
          initial={s?.name ?? game.name}
          secret={false}
          onChange={() => undefined}
          onClose={(submit, v) => {
            setNaming(false)
            const name = v.trim()
            if (submit && name) set({ [game.id]: { name } })
          }}
        />
      )}
    </>
  )
}
