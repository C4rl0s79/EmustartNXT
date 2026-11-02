import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME, THEMES, contrast, lookDefaults, lookSpecFor, themeById, themeStyle } from '../src/renderer/src/tv/themes'
import { FONTS, type LookChoice } from '../src/renderer/src/tv/look'
import { LOOK_ITEMS } from '../src/renderer/src/tv/look'
import { flowOffset } from '../src/renderer/src/tv/TvCoverflow'

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
  // widths in cover widths (W): the selected one scaled 1.08 (half = 0.54); a neighbour turned 58°,
  // scaled 0.8, with its own perspective, measured 0.43 W on a 4K screen (half 0.215; 0.22 here)
  const SEL_HALF = 0.54
  const SIDE_HALF = 0.22

  it('no cover covers the selected one or its neighbour', () => {
    expect(flowOffset(0)).toBe(0)
    expect(flowOffset(1) - SIDE_HALF).toBeGreaterThan(SEL_HALF)
    for (let d = 1; d < 5; d++) expect(flowOffset(d + 1) - flowOffset(d)).toBeGreaterThan(2 * SIDE_HALF)
    expect(flowOffset(-3)).toBe(-flowOffset(3))
  })
})
