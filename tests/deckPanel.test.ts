import { describe, expect, it } from 'vitest'
import { deckGeometry, defaultDeckLayout, moveDeckGroup, type DeckGroup } from '@shared/deck'
import { tileMetrics } from '../src/renderer/src/deck/DeckPanel'

const area = { x: 0, y: 0, width: 2560, height: 1400 }
const lay = { ...defaultDeckLayout(), dockWidth: 0.99, panelWidth: 0.9, panelHeight: 0.8 }

describe('deckGeometry (deck_app._panel_rect)', () => {
  it('collapsed: the window is the dock; the panel width is known for sizing the tiles', () => {
    const g = deckGeometry(area, lay, null)
    expect(g.expanded).toBe(false)
    expect(g.window).toEqual({ x: 13, y: 0, width: 2534, height: 46 })
    expect(g.dock).toEqual({ x: 0, y: 0, width: 2534, height: 46 })
    expect(g.panel).toMatchObject({ width: 2304, height: 0 })
  })

  it('expanded: one window spans the dock and the panel 8 px below it, as tall as the tiles need', () => {
    const g = deckGeometry(area, lay, 500)
    expect(g.expanded).toBe(true)
    expect(g.window).toEqual({ x: 13, y: 0, width: 2534, height: 46 + 8 + 500 })
    expect(g.dock).toEqual({ x: 0, y: 0, width: 2534, height: 46 })
    expect(g.panel).toEqual({ x: 115, y: 54, width: 2304, height: 500 })
  })

  it('never taller than its share of the screen nor past the work area; at least 160 px', () => {
    expect(deckGeometry(area, lay, 50_000).panel.height).toBe(1120)
    expect(deckGeometry({ ...area, height: 600 }, { ...lay, panelHeight: 1 }, 50_000).panel.height).toBe(600 - 46 - 16)
    expect(deckGeometry(area, lay, 20).panel.height).toBe(160)
  })

  it('a panel wider than the dock widens the window; its left edge and width are the same open and closed', () => {
    const wide = { ...lay, dockWidth: 0.5, panelWidth: 0.9 }
    const o = deckGeometry(area, wide, 300)
    const c = deckGeometry(area, wide, null)
    expect(o.window.x).toBe(128)
    expect(o.window.width).toBe(2304)
    expect(o.dock.x).toBe(640 - 128)
    expect(o.panel.x).toBe(0)
    expect([c.window.x, c.window.width, c.dock.x, c.window.height]).toEqual([128, 2304, 512, 46])
  })

  it('with no room under the dock the panel does not open', () => {
    const g = deckGeometry({ x: 0, y: 0, width: 1920, height: 100 }, lay, 500)
    expect(g.expanded).toBe(false)
    expect(g.window.height).toBe(46)
  })
})

describe('tileMetrics (tiles.py: columns, constant gap, tiles fill the row)', () => {
  it('cols columns fill the panel width with an 8 px gap; portrait 2:3 or square', () => {
    const m = tileMetrics(1000, 4, 'portrait', false, 9)
    expect(m.tileW).toBe((1000 - 16 - 24) / 4)
    expect(m.tileH).toBe(m.tileW * 1.5)
    expect(m.rows).toBe(3)
    expect(m.content).toBe(3 * (m.tileH + 8) - 8 + 16)
    expect(tileMetrics(1000, 4, 'square', false, 1).tileH).toBe((1000 - 16 - 24) / 4)
  })

  it('titles under the tiles add two lines to each row', () => {
    expect(tileMetrics(1000, 4, 'portrait', true, 4).rowH - tileMetrics(1000, 4, 'portrait', false, 4).rowH).toBe(34)
  })
})

describe('moveDeckGroup: columns from the panel (Ctrl + wheel)', () => {
  const gs: DeckGroup[] = [{ id: 'a/1', cols: 8, aspect: 'portrait', hidden: false }]
  it('sets the columns, kept in 1–24; the same array when unchanged', () => {
    expect(moveDeckGroup(gs, { id: 'a/1', cols: 9 })[0].cols).toBe(9)
    expect(moveDeckGroup(gs, { id: 'a/1', cols: 99 })[0].cols).toBe(24)
    expect(moveDeckGroup(gs, { id: 'a/1', cols: 8 })).toBe(gs)
  })
})
