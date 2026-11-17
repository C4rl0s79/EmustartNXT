import { useEffect, useRef, useState } from 'react'
import type { Game } from '@shared/types'
import { api, attempt, useStore } from '../store'
import { useActions } from '../nav/input'
import { focusFirst } from '../nav/engine'
import { launchFromStart, runPrimary, usePrimaryAction } from '../lib/primary'
import { versionCountLabel } from '../lib/format'
import { GameOptions, type OptionsStart } from '../components/GameOptions'
import { Icon } from '../components/Icon'
import { FactRow, LogoTitle, TvBackdrop, TvDesc, forgetEmuOptions, useDetails, useGameFacts, type FactGroup } from './gameParts'

// The game's page in the TV layout (A on the game list): its background, logo, the main actions in one row
// (play first — A, A still starts a game), the description with room to read and the facts in three cards.
// Everything else stays in "Opcje gry", opened from here. B goes back to the list, on the same game.

const GROUPS: [FactGroup, string][] = [
  ['pc', 'Na tym komputerze'],
  ['you', 'Twoja gra'],
  ['about', 'O grze']
]

export function TvGamePage({ game, onBack, onMenu }: { game: Game; onBack: () => void; onMenu: () => void }) {
  const d = useDetails(game)
  const [rev, setRev] = useState(0) // the facts read EmuStart's data again after "Opcje gry"
  const facts = useGameFacts(game, d, rev)
  const { primary, busy } = usePrimaryAction(game)
  const isFav = useStore((s) => !!s.prefs?.favorites.includes(game.id))
  const [options, setOptions] = useState<OptionsStart | null>(null)
  const rootRef = useRef<HTMLElement>(null)
  const e = game.emu
  const extras = game.gog?.extras?.length ?? 0
  // dodatki GOG czyta silnik — jak w oknie „Opcje gry”: bez działającego silnika przycisku nie ma
  const engineReady = useStore((s) => s.snapshot?.emustart?.engine === 'ready')

  useEffect(() => {
    const t = setTimeout(() => rootRef.current && focusFirst(rootRef.current), 0)
    return () => clearTimeout(t)
  }, [])

  const play = (): void => runPrimary(primary, busy)

  useActions(
    {
      back: () => {
        onBack()
        return true
      },
      menu: () => {
        onMenu()
        return true
      },
      x: () => {
        play()
        return true
      },
      y: () => {
        setOptions('main')
        return true
      },
      rs: () => {
        void attempt(api().prefs.toggleFavorite(game.id))
        return true
      }
    },
    {
      modal: true,
      enabled: !options,
      hints: [
        { action: 'confirm', label: 'Wybierz' },
        { action: 'x', label: primary?.label ?? 'Graj' },
        { action: 'y', label: 'Opcje gry' },
        { action: 'rs', label: isFav ? 'Usuń z ulubionych' : 'Ulubiona' },
        { action: 'back', label: 'Lista gier' }
      ]
    }
  )

  return (
    <section className="tv-gamepage" data-layer ref={rootRef}>
      <TvBackdrop game={game} />
      <div className="tv-gamepage__main">
        <div className="tv-gamepage__logo">
          <LogoTitle key={game.id} game={game} text={<h1>{game.name}</h1>} />
        </div>
        <div className="tv-gamepage__actions">
          <button className="tv-act tv-act--play" data-nav data-autofocus disabled={busy} onClick={play}>
            <Icon name="play" /> {primary?.label ?? 'Graj'}
          </button>
          {e && (
            <button className="tv-act" data-nav disabled={busy || !primary?.run || primary.disabled} onClick={() => void launchFromStart(game.id)}>
              Graj od początku
            </button>
          )}
          <button className="tv-act" data-nav onClick={() => setOptions('main')}>
            Opcje gry…
          </button>
          <button className={`tv-act ${isFav ? 'is-on' : ''}`} data-nav onClick={() => void attempt(api().prefs.toggleFavorite(game.id))}>
            <Icon name={isFav ? 'starFilled' : 'star'} /> {isFav ? 'W ulubionych' : 'Ulubiona'}
          </button>
          {extras > 0 && engineReady && (
            <button className="tv-act" data-nav onClick={() => setOptions('extras')}>
              Dodatki ({extras})
            </button>
          )}
          {e?.versions && (
            <button className="tv-act" data-nav onClick={() => setOptions('versions')}>
              {versionCountLabel(e.versions.length)}
            </button>
          )}
        </div>
        {primary?.disabled && primary.note && <p className="tv-note">{primary.note}</p>}
        <TvDesc game={game} details={d} className="tv-gamepage__desc selectable" />
      </div>
      <aside className="tv-gamepage__facts">
        {GROUPS.map(([g, title]) => {
          const rows = facts.filter((f) => f.group === g)
          return rows.length ? (
            <div key={g} className="tv-card">
              <h2>{title}</h2>
              <dl>
                {rows.map((f) => (
                  <FactRow key={f.k} f={f} />
                ))}
              </dl>
            </div>
          ) : null
        })}
      </aside>
      {options && (
        <GameOptions
          game={game}
          start={options}
          onClose={() => {
            forgetEmuOptions(game.id)
            setRev((r) => r + 1)
            setOptions(null)
            setTimeout(() => rootRef.current && focusFirst(rootRef.current), 0)
          }}
        />
      )}
    </section>
  )
}

