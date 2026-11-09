import { memo } from 'react'
import type { Game } from '@shared/types'
import { Art } from './Art'
import { Icon } from './Icon'
import { isBusy, versionCountLabel } from '../lib/format'

interface Props {
  game: Game
  favorite?: boolean
  onOpen: (game: Game) => void
  onFocusGame?: (game: Game) => void
  autofocus?: boolean
}

export const Poster = memo(function Poster({ game, favorite, onOpen, onFocusGame, autofocus }: Props) {
  return (
    <button
      className={`poster ${game.installed ? '' : 'is-uninstalled'}`}
      data-nav
      data-key={game.id}
      data-autofocus={autofocus || undefined}
      onClick={() => onOpen(game)}
      onFocus={() => onFocusGame?.(game)}
      aria-label={game.name}
      title={game.name}
    >
      <div className="poster__frame">
        {/* under the art: the name stays readable while the image loads or when there is none */}
        <span className="poster__name" aria-hidden="true">
          {game.name}
        </span>
        <Art gameId={game.id} name={game.name} kind="grid" thumb />
        <div className="poster__badges">
          {game.running && <span className="badge badge--live">W grze</span>}
          {isBusy(game) && <span className="badge badge--busy">Pobieranie</span>}
          {game.installState === 'updateRequired' && <span className="badge">Aktualizacja</span>}
          {game.source === 'demo' && <span className="badge badge--demo">DEMO</span>}
          {game.emu?.versions && <span className="badge badge--versions">{versionCountLabel(game.emu.versions.length)}</span>}
        </div>
        {favorite && (
          <span className="poster__fav" title="Ulubiona">
            <Icon name="starFilled" />
            <span className="sr-only">Ulubiona</span>
          </span>
        )}
        {game.emu && game.emu.discs > 1 && (
          <span className="poster__discs" aria-label={`${game.emu.discs} płyty`} title={`${game.emu.discs} płyty`}>
            <Icon name="disc" />
            {game.emu.discs}
          </span>
        )}
        {!game.installed && (
          <span className="poster__cloud">
            <Icon name="download" />
            <span className="poster__cloud-txt">Niezainstalowana</span>
          </span>
        )}
      </div>
      <div className="poster__label">{game.name}</div>
    </button>
  )
})
