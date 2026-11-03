import { describe, expect, it } from 'vitest'
import { emuSystem } from '../src/main/emustart/mapping'
import { pixelZoom } from '../src/renderer/src/tv/SystemLogo'

// All data below is synthetic.

describe('pixel-art platform logos', () => {
  it('the server flag reaches the renderer only for a logo', () => {
    const sys = { es: 'psx', display: 'PlayStation', games: 1, cached: 0, emulator: '' }
    expect(emuSystem({ ...sys, logo: '/media/_systems/psx.custom.png?v=2', logo_pixel: true }).logoPixel).toBe(true)
    expect(emuSystem({ ...sys, logo: '/media/_systems/psx.custom.png?v=2' }).logoPixel).toBeUndefined()
    expect(emuSystem({ ...sys, logo: '', logo_pixel: true }).logoPixel).toBeUndefined()
  })
  it('zooms by whole numbers only: the largest that fits, at least 1×', () => {
    expect(pixelZoom(32, 32, 300, 200)).toBe(6) //   192 px — 7× (224) would not fit the height
    expect(pixelZoom(32, 32, 319, 400)).toBe(9) //   288 px wide, every art pixel 9 screen pixels
    expect(pixelZoom(32, 16, 100, 100)).toBe(3)
    expect(pixelZoom(64, 64, 40, 40)).toBe(1) //     never below 1× (the frame may clip, the pixels stay square)
    expect(pixelZoom(0, 0, 100, 100)).toBe(1)
  })
})
