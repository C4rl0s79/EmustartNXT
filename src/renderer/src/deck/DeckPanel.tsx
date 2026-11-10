import { useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Game } from '@shared/types'
import { DECK_TILE_GAP, clampCols, type DeckAspect } from '@shared/deck'
import { api, useStore } from '../store'

// The games panel under the dock (PyLinksDeck panel.py / tiles.py): the active tab's games as tiles. The
// tile size is a number of columns (Ctrl + wheel: one column more / fewer) — the tiles stretch to fill the
// row with a constant gap, so the grid looks the same on every screen and scale. As tall as its tiles need,
// up to the panel's maximum (the main process sizes the window: deckGeometry); virtualised for big groups.

const PAD = 8
/** two lines of a title under the tile */
const LABEL_H = 34
/** one wheel notch → one column more / fewer; a touchpad pinch's burst of events is not a dozen notches */
const ZOOM_STEP_MS = 120

export interface TileMetrics {
  tileW: number
  tileH: number
  rowH: number
  rows: number
  /** height all the tiles need, padding included */
  content: number
}

export function tileMetrics(width: number, cols: number, aspect: DeckAspect, labels: boolean, count: number): TileMetrics {
  const inner = Math.max(0, width - 2 * PAD)
  const tileW = Math.max(1, (inner - DECK_TILE_GAP * (cols - 1)) / cols)
  const tileH = aspect === 'square' ? tileW : tileW * 1.5
  const rowH = tileH + (labels ? LABEL_H : 0) + DECK_TILE_GAP
  const rows = Math.ceil(count / cols)
  return { tileW, tileH, rowH, rows, content: rows ? rows * rowH - DECK_TILE_GAP + 2 * PAD : 2 * PAD + 40 }
}

export function DeckPanel({
  games,
  cols,
  aspect,
  showLabels,
  width,
  height,
  onCols
}: {
  games: Game[]
  cols: number
  aspect: DeckAspect
  showLabels: boolean
  width: number
  height: number
  onCols: (cols: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  // the tiles fill the space inside the panel — without its scroll bar (a long list), or the last column is cut
  const [inner, setInner] = useState<number | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setInner(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const m = tileMetrics(inner ?? width, cols, aspect, showLabels, games.length)
  const artRev = useStore((s) => s.artRev)
  const v = useVirtualizer({ count: m.rows, getScrollElement: () => ref.current, estimateSize: () => m.rowH, overscan: 2 })
  useEffect(() => v.measure(), [m.rowH, v])

  // Ctrl + wheel: columns (a passive React wheel listener cannot stop the page's own zoom)
  const colsRef = useRef(cols)
  colsRef.current = cols
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let last = 0
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey || !e.deltaY) return
      e.preventDefault()
      if (e.timeStamp - last < ZOOM_STEP_MS) return
      last = e.timeStamp
      colsRef.current = clampCols(colsRef.current + (e.deltaY > 0 ? 1 : -1))
      onCols(colsRef.current)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [onCols])

  return (
    <div ref={ref} className="deck-panel" style={{ width, height }}>
      {games.length ? (
        <div style={{ height: v.getTotalSize(), position: 'relative' }}>
          {v.getVirtualItems().map((row) => (
            <div key={row.index} className="deck-row" style={{ top: row.start, height: m.rowH - DECK_TILE_GAP, gap: DECK_TILE_GAP }}>
              {games.slice(row.index * cols, row.index * cols + cols).map((g) => (
                <div key={g.id} className="deck-tile" style={{ width: m.tileW }} title={g.name}>
                  <div className="deck-tile-art" style={{ height: m.tileH }}>
                    <img src={api().art.url(g.id, 'grid', artRev[g.id] ?? 0, undefined, true)} alt="" draggable={false} loading="lazy" />
                    <span className="deck-tile-fallback">{g.name}</span>
                  </div>
                  {showLabels && <div className="deck-tile-name">{g.name}</div>}
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="deck-panel-empty">Brak gier w tej zakładce</div>
      )}
    </div>
  )
}
