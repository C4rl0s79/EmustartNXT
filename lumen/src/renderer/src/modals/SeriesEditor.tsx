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
  const listRef = useRef<HTMLDivElement>(null)
  const members = useMemo(() => seriesMembers(game, all ?? [game], series), [game, all, series])
  const own = series?.[game.id]
  const s = seriesOf(game, series)
  const i = members.findIndex((g) => g.id === game.id)
  const inSeries = !!s && members.length > 1

  useEffect(() => {
    const t = setTimeout(() => listRef.current && focusFirst(listRef.current), 0)
    return () => clearTimeout(t)
  }, [])

  const set = (changes: Record<string, SeriesPrefs[string] | null>): void => void attempt(api().prefs.setSeries(changes))
  const move = (dir: -1 | 1): void => {
    const next = moveInSeries(members, game.id, dir, series)
    if (next) set(next)
  }

  const rows: { label: string; value?: string; act?: () => void; mark?: boolean }[] = [
    ...(inSeries
      ? [
          { label: 'Wcześniej w serii', act: i > 0 ? () => move(-1) : undefined },
          { label: 'Później w serii', act: i < members.length - 1 ? () => move(1) : undefined }
        ]
      : []),
    { label: inSeries ? 'Zmień nazwę serii…' : 'Dołącz do serii…', value: 'ta sama nazwa co inna gra — razem z nią', act: () => setNaming(true) },
    ...(own?.none ? [] : [{ label: 'Nie należy do serii', act: () => set({ [game.id]: { none: true } }) }]),
    ...(own ? [{ label: 'Rozpoznawaj z tytułu', value: 'bez Twoich zmian dla tej gry', act: () => set({ [game.id]: null }) }] : []),
    ...(inSeries
      ? members.map((g, k) => ({ label: `${k + 1}. ${g.name}`, value: String(yearOf(g) ?? ''), mark: g.id === game.id }))
      : [])
  ]

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
          {inSeries ? `${s!.name}: gry stoją razem na listach po tytule, w tej kolejności.` : 'Ta gra nie stoi w żadnej serii.'}
        </p>
        <div className="gopt__list" ref={listRef}>
          {rows.map((r, k) => (
            <button
              key={r.label + k}
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
