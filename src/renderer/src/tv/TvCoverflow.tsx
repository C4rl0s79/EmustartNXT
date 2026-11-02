import { memo } from 'react'
import type { Game } from '@shared/types'
import { Art } from '../components/Art'

// The game list as a horizontal ribbon of covers (themes with games.layout = "coverflow"): the
// selected cover stands in the middle facing the player, its neighbours turn towards it. Spacing is
// worked out so that no cover covers another. In cover widths (W): the selected one is scaled 1.08
// (half = 0.54); a neighbour turned 58° and scaled 0.8, with its own perspective, is 0.43 W wide
// (measured: 136 px at W = 318 px): first neighbour at 0.86 W, each next one 0.55 W further.

const SIDE = 5 // covers drawn on each side of the selected one

export function flowOffset(d: number): number {
  if (d === 0) return 0
  const a = Math.abs(d)
  return Math.sign(d) * (0.86 + (a - 1) * 0.55)
}

export function TvCoverflow({ games, idx, onPick, reflection }: { games: Game[]; idx: number; onPick: (i: number) => void; reflection: boolean }) {
  const from = Math.max(0, idx - SIDE)
  const to = Math.min(games.length - 1, idx + SIDE)
  const items: number[] = []
  for (let i = from; i <= to; i++) items.push(i)
  return (
    <div className={`tv-flow ${reflection ? 'tv-flow--mirror' : ''}`}>
      <div className="tv-flow__stage">
        {items.map((i) => (
          <FlowItem key={games[i].id} game={games[i]} d={i - idx} onPick={() => onPick(i)} />
        ))}
      </div>
    </div>
  )
}

const FlowItem = memo(function FlowItem({ game, d, onPick }: { game: Game; d: number; onPick: () => void }) {
  const a = Math.abs(d)
  const turn = d === 0 ? 0 : -Math.sign(d) * 58
  return (
    <div
      className={`tv-flow__item ${d === 0 ? 'sel' : ''}`}
      style={{
        // each cover has its own perspective (not the ribbon's): every turned cover then looks the same
        // and is equally wide, however far from the middle it stands
        transform: `translateX(calc(-50% + ${flowOffset(d)} * var(--tv-flow-w))) perspective(1100px) rotateY(${turn}deg) scale(${d === 0 ? 1.08 : 0.8})`,
        zIndex: 20 - a,
        opacity: a > SIDE - 1 ? 0 : 1
      }}
      onClick={onPick}
    >
      <div className="tv-flow__cover">
        <Art gameId={game.id} name={game.name} kind="grid" fallback="poster" eager={a <= 2} layout="tv" />
      </div>
    </div>
  )
})
