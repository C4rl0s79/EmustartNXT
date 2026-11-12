import { memo, useSyncExternalStore } from 'react'
import type { Game } from '@shared/types'
import { Art } from '../components/Art'

// The game list as a horizontal ribbon of covers (themes with games.layout = "coverflow"): the
// selected cover stands in the middle facing the player, its neighbours turn towards it.
//
// Every cover keeps the shape of its own picture: a portrait poster is as tall as the ribbon, a
// landscape box (SNES, N64) is as wide as the frame allows and lower — all standing on one line (the
// horizon), so the reflections start together. Until a picture has loaded it takes the shape usual
// for this list (the median of the shapes already seen), so nothing jumps much.
//
// Sizes are in units of the ribbon's height H. Covers get smaller away from the middle (flowScale: a
// perspective without a shared 3D camera, so every cover's width on screen stays known). Spacing is
// worked out from each cover's own width and scale so that none covers another: the selected cover is
// scaled 1.08 (half width 0.54 w); a neighbour turned 58° with its own perspective shows about 0.8 of
// its width per unit of scale (measured: 136 px of a 318 px cover at 0.8) — half of it 0.4 w per unit,
// counted as 0.4125 — and a gap of 0.07 H stays between covers.

const SIDE = 5 // covers drawn on each side of the selected one
const MAX_W = 1.1 // widest cover, in H (a landscape box)
const GAP = 0.07
const SEL_HALF = 0.54
const SIDE_HALF = 0.4125 // per unit of a neighbour's scale
const SCALES = [1.08, 0.88, 0.74, 0.62, 0.52, 0.44]

/** a cover's scale by its distance from the selected one (0 = selected) */
export function flowScale(d: number): number {
  return SCALES[Math.min(Math.abs(d), SCALES.length - 1)]
}

/** a cover's box for a picture's width / height: [width, height] in H */
export function coverBox(ratio: number): [number, number] {
  const r = Math.min(2.2, Math.max(0.45, ratio || 2 / 3))
  const w = Math.min(r, MAX_W)
  return [w, w / r]
}

/** the centre of each cover from the selected one (index `sel`), in H, from the covers' widths */
export function flowLayout(widths: number[], sel: number): number[] {
  const x = new Array<number>(widths.length).fill(0)
  const half = (i: number): number => (i === sel ? SEL_HALF : SIDE_HALF * flowScale(i - sel)) * widths[i]
  for (let i = sel + 1; i < widths.length; i++) x[i] = x[i - 1] + half(i - 1) + GAP + half(i)
  for (let i = sel - 1; i >= 0; i--) x[i] = x[i + 1] - half(i + 1) - GAP - half(i)
  return x
}

// ---- picture shapes, as the covers load (shared by every ribbon of this window) ----
const ratios = new Map<string, number>()
let version = 0
const listeners = new Set<() => void>()
function setRatio(id: string, r: number): void {
  if (!(r > 0) || Math.abs((ratios.get(id) ?? 0) - r) < 0.01) return
  ratios.set(id, r)
  version++
  listeners.forEach((l) => l())
}
function useRatios(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => version
  )
}

function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** covers of the ribbon, left to right: list index, distance from the selected one, which repeat of the list */
export function flowWindow(n: number, idx: number): { i: number; d: number; copy: number }[] {
  if (n <= 0) return []
  const out = []
  for (let d = -SIDE; d <= SIDE; d++) {
    const v = idx + d
    out.push({ i: ((v % n) + n) % n, d, copy: Math.floor(v / n) })
  }
  return out
}

export function TvCoverflow({ games, pos, onPick, reflection }: { games: Game[]; pos: number; onPick: (i: number) => void; reflection: boolean }) {
  useRatios()
  const n = games.length
  // the ribbon goes round: SIDE covers on each side always, a short list repeats its covers to fill the screen
  // pozycja bez modulo (TvGames): klucz okładki = gra + które powtórzenie listy — przy przejściu przez koniec listy
  // okładki zostają tymi samymi elementami (animacja przesunięcia), zamiast rysować się od nowa (przeskok)
  const items = flowWindow(n, pos)
  const idx = ((pos % n) + n) % n
  // shape of a cover not loaded yet: the usual one in this list (SNES boxes, PS1 cases, posters…)
  const usual = median(games.slice(Math.max(0, idx - 30), idx + 30).map((g) => ratios.get(g.id)).filter((r): r is number => !!r)) ?? 2 / 3
  const boxes = items.map((it) => coverBox(ratios.get(games[it.i].id) ?? usual))
  const x = flowLayout(
    boxes.map((b) => b[0]),
    SIDE
  )
  return (
    <div className={`tv-flow ${reflection ? 'tv-flow--mirror' : ''}`}>
      <div className="tv-flow__stage">
        {items.map((it, k) => (
          <FlowItem key={`${games[it.i].id}#${it.copy}`} game={games[it.i]} d={it.d} x={x[k]} box={boxes[k]} onPick={() => onPick(it.i)} />
        ))}
      </div>
    </div>
  )
}

const FlowItem = memo(function FlowItem({ game, d, x, box, onPick }: { game: Game; d: number; x: number; box: [number, number]; onPick: () => void }) {
  const a = Math.abs(d)
  const turn = d === 0 ? 0 : -Math.sign(d) * 58
  return (
    <div
      className={`tv-flow__item ${d === 0 ? 'sel' : ''}`}
      style={{
        ['--w' as string]: box[0],
        ['--h' as string]: box[1],
        // each cover has its own perspective (not the ribbon's): every turned cover then looks the same
        // and its width is what the spacing counts on, however far from the middle it stands
        transform: `translateX(calc(-50% + ${x.toFixed(3)} * var(--tv-flow-h))) perspective(1100px) rotateY(${turn}deg) scale(${flowScale(d)})`,
        zIndex: 20 - a,
        opacity: a > SIDE - 1 ? 0 : 1
      }}
      onClick={onPick}
    >
      <div className="tv-flow__cover">
        {/* under the art: the name while the cover loads (never an empty frame) */}
        <span className="tv-flow__name" aria-hidden="true">
          {game.name}
        </span>
        {/* mała kopia jak na plakatach pulpitu (thumb; animowane — tak jak są): pełne PNG ze SteamGridDB (~1 MB) dekodowane
            przy każdym kroku zatrzymywały przewijanie wstęgi przy grach Steam (pomiar na danych gracza) */}
        <Art gameId={game.id} name={game.name} kind="grid" fallback="poster" eager={a <= 2} layout="tv" thumb anim onRatio={(r) => setRatio(game.id, r)} />
      </div>
    </div>
  )
})
