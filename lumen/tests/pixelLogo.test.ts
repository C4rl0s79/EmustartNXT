import { describe, expect, it } from 'vitest'
import { emuSystem } from '../src/main/emustart/mapping'
import { pixelSize, pixelZoom } from '../src/renderer/src/tv/SystemLogo'

// All data below is synthetic.

describe('pixel-art platform logos', () => {
  it('the server tells the size of an art pixel; only a logo carries it', () => {
    const sys = { es: 'psx', display: 'PlayStation', games: 1, cached: 0, emulator: '' }
    expect(emuSystem({ ...sys, logo: '/media/_systems/psx.custom.png?v=2', logo_pixel: 8 }).logoPixel).toBe(8)
    expect(emuSystem({ ...sys, logo: '/media/_systems/psx.custom.png?v=2' }).logoPixel).toBeUndefined()
    expect(emuSystem({ ...sys, logo: '', logo_pixel: 8 }).logoPixel).toBeUndefined()
  })
  it('zooms by whole numbers only: the largest that fits, at least 1×', () => {
    expect(pixelZoom(32, 32, 300, 200)).toBe(6)
    expect(pixelZoom(32, 32, 319, 400)).toBe(9)
    expect(pixelZoom(64, 64, 40, 40)).toBe(1) // never below 1× (the frame may clip, the pixels stay square)
    expect(pixelZoom(0, 0, 100, 100)).toBe(1)
  })
  it('counts the art pixels of a pre-enlarged file (dot-art: 8 file pixels each)', () => {
    // 248×184 file = 31×23 art pixels; area 369×99 → 4 screen pixels per art pixel
    expect(pixelSize(248, 184, 8, 369, 99, 1)).toEqual({ w: 124, h: 92 })
    expect(pixelSize(129, 33, 1, 369, 99, 1)).toEqual({ w: 258, h: 66 }) // native pixel art: 2×
  })
  it('stays even under Windows display scaling: whole device pixels per art pixel', () => {
    const { w, h } = pixelSize(248, 184, 8, 369, 99, 1.5) // 553×148 device px → 6 device px per art pixel
    expect(w * 1.5).toBe(31 * 6)
    expect(h * 1.5).toBe(23 * 6)
  })
})
