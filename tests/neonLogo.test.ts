import { describe, expect, it } from 'vitest'
import { NEON_HUE, dominantHue, neonPixels } from '../src/renderer/src/lib/neonLogo'
import { toHsl } from '../src/renderer/src/lib/glow'

const px = (...rgba: number[][]): Uint8ClampedArray => new Uint8ClampedArray(rgba.flat())
const hslAt = (d: Uint8ClampedArray, i: number) => toHsl([d[i * 4], d[i * 4 + 1], d[i * 4 + 2]])
/** distance between two hues on the colour wheel */
const hueGap = (a: number, b: number): number => Math.min(Math.abs(a - b), 360 - Math.abs(a - b))

describe('neon platform logos (colours from the logo itself)', () => {
  it('the characteristic hue is the one of the colourful pixels, black and white do not count', () => {
    const d = px([220, 30, 30, 255], [200, 20, 40, 255], [0, 0, 0, 255], [255, 255, 255, 255], [20, 20, 220, 120])
    expect(hueGap(dominantHue(d) ?? -99, 0)).toBeLessThan(10)              // red
    expect(dominantHue(px([0, 0, 0, 255], [255, 255, 255, 255]))).toBeNull()
  })

  it('black lettering becomes light and tinted with the logo hue, white stays white', () => {
    const d = px([30, 60, 230, 255], [30, 60, 230, 255], [0, 0, 0, 255], [255, 255, 255, 255])
    const hue = neonPixels(d)
    const [h2, s2, l2] = hslAt(d, 2)
    expect(l2).toBeGreaterThanOrEqual(0.73)
    expect(hueGap(h2, hue)).toBeLessThan(3)
    expect(s2).toBeGreaterThan(0.3)
    expect(hslAt(d, 3)[2]).toBeGreaterThan(0.97)
  })

  it('colours keep their hue and get brighter; transparent pixels are left alone', () => {
    const d = px([140, 20, 20, 255], [9, 9, 9, 0])
    const [h0, , l0] = toHsl([140, 20, 20])
    neonPixels(d)
    const [h1, s1, l1] = hslAt(d, 0)
    expect(hueGap(h1, h0)).toBeLessThan(3)
    expect(l1).toBeGreaterThan(l0)
    expect(s1).toBeGreaterThan(0.6)
    expect([...d.slice(4)]).toEqual([9, 9, 9, 0])
  })

  it('a logo without colour glows in the default hue', () => {
    expect(neonPixels(px([0, 0, 0, 255], [128, 128, 128, 255]))).toBe(NEON_HUE)
  })
})
