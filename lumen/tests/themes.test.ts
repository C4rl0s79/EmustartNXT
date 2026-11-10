import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME, THEMES, contrast, lookDefaults, lookSpecFor, themeById, themeStyle } from '../src/renderer/src/tv/themes'
import { FONTS, type LookChoice } from '../src/renderer/src/tv/look'
import { LOOK_ITEMS } from '../src/renderer/src/tv/look'
import { coverBox, flowLayout, flowScale } from '../src/renderer/src/tv/TvCoverflow'

describe('TV themes', () => {
  it('has the default theme and unique ids; an unknown id falls back to the default', () => {
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length)
    expect(themeById(undefined).id).toBe(DEFAULT_THEME)
    expect(themeById('no-such-theme').id).toBe(DEFAULT_THEME)
    expect(themeById('sf').games.layout).toBe('coverflow')
  })

  it('keeps every palette readable (the pad contract: text 4.5:1, the selection 4.5:1, accent 3:1)', () => {
    for (const t of THEMES) {
      const p = t.palette
      if (!p) continue
      expect(contrast(p.text, p.bg), `${t.id} text`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(p.dim, p.bg), `${t.id} dim`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(p.selText, p.selBg), `${t.id} selection`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(p.accent, p.bg), `${t.id} accent`).toBeGreaterThanOrEqual(3)
    }
  })

  it('only locks keys the look editor has, and hides them there', () => {
    const keys = new Set(LOOK_ITEMS.map((i) => i.k))
    for (const t of THEMES) {
      for (const k of t.locks) expect(keys.has(k), `${t.id} locks ${k}`).toBe(true)
      const shown = lookSpecFor(t).filter((r) => 'k' in r).map((r) => ('k' in r ? r.k : ''))
      for (const k of t.locks) expect(shown).not.toContain(k)
      // no heading is left without rows under it
      const rows = lookSpecFor(t)
      rows.forEach((r, i) => {
        if (!('k' in r)) expect(i + 1 < rows.length && 'k' in rows[i + 1], `${t.id}: empty heading ${r.head}`).toBe(true)
      })
    }
    expect(lookSpecFor(themeById('emustart')).filter((r) => 'k' in r)).toHaveLength(LOOK_ITEMS.length)
  })

  it('offers its own typefaces in the look editor, each one bundled, the legible one in every theme', () => {
    for (const t of THEMES) {
      for (const f of [...t.fonts.text, ...t.fonts.head]) expect(FONTS[f], `${t.id}: ${f}`).toBeTruthy()
      expect(t.fonts.text).toContain('atkinson')
      const font = lookSpecFor(t).find((r) => 'k' in r && r.k === 'font') as LookChoice
      expect(font.opts).toEqual(t.fonts.text)
      expect(font.def).toBe(lookDefaults(t).font)
    }
  })

  it('the palette becomes the CSS variables of the TV frame', () => {
    expect(themeStyle(themeById('emustart'))).toEqual({})
    expect(themeStyle(themeById('fantasy'))['--tv-bg']).toBe('#130e0b')
  })
})

describe('cover ribbon spacing', () => {
  // the selected cover: half 0.54 w (scale 1.08); a turned neighbour shows ~0.4 of its width per unit of
  // its scale (measured: 0.64 w at 0.8) — and the scale falls with the distance from the middle
  const half = (i: number, w: number[], sel: number): number => (i === sel ? 0.54 : 0.4 * flowScale(i - sel)) * w[i]
  const covered = (x: number[], w: number[], sel: number): boolean =>
    x.some((xi, i) => i + 1 < x.length && xi + half(i, w, sel) > x[i + 1] - half(i + 1, w, sel))

  it('covers get smaller away from the middle (perspective) and stay as close as their sizes allow', () => {
    for (let d = 1; d < 5; d++) expect(flowScale(d)).toBeLessThan(flowScale(d - 1))
    expect(flowScale(-2)).toBe(flowScale(2))
    const poster = coverBox(2 / 3)[0]
    const w = Array(9).fill(poster)
    const x = flowLayout(w, 4)
    // between the visible edges of neighbours: a small gap everywhere (0.07 H and the margin), so smaller
    // covers further out stand closer together
    const gaps = x.slice(1).map((xi, i) => xi - half(i + 1, w, 4) - (x[i] + half(i, w, 4)))
    for (const g of gaps) {
      expect(g).toBeGreaterThan(0.05)
      expect(g).toBeLessThan(0.1)
    }
    expect(x[1] - x[0]).toBeLessThan(x[3] - x[2])
  })

  it('no cover covers another, with posters, landscape boxes or both mixed', () => {
    const poster = coverBox(2 / 3)[0]
    const snes = coverBox(1.4)[0]
    for (const w of [Array(9).fill(poster), Array(9).fill(snes), [poster, snes, poster, snes, snes, poster, snes, poster, poster]])
      for (const sel of [0, 4, 8]) expect(covered(flowLayout(w, sel), w, sel)).toBe(false)
    expect(flowLayout([poster, poster, poster], 1)[1]).toBe(0)
  })

  it('landscape boxes are as wide as allowed and lower; posters full height', () => {
    expect(coverBox(2 / 3)).toEqual([2 / 3, 1])
    const [w, h] = coverBox(1.4)
    expect(w).toBe(1.1)
    expect(h).toBeCloseTo(1.1 / 1.4)
  })
})
