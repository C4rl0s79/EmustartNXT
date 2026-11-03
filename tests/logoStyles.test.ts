import { describe, expect, it } from 'vitest'
import { NEON_HUE, dominantHue, enamelPixels, neonPixels } from '../src/renderer/src/lib/logoStyles'
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

describe('enamel platform logos (Kronika): flat colour fields in gold wire', () => {
  // 11×11 logo: a red field with a black bar in column 7
  const W = 11
  const logo = (): Uint8ClampedArray => {
    const d = new Uint8ClampedArray(W * W * 4)
    for (let i = 0; i < W * W; i++) d.set(i % W === 7 ? [0, 0, 0, 255] : [200, 30, 30, 255], i * 4)
    return d
  }
  const at = (d: Uint8ClampedArray, x: number, y: number) =>
    toHsl([d[(y * W + x) * 4], d[(y * W + x) * 4 + 1], d[(y * W + x) * 4 + 2]])
  const isWire = ([h, , l]: number[]): boolean => hueGap(h, 42) < 6 && l > 0.8

  it('gold wire runs along the outline and where two colours meet; the inside of a field stays enamel', () => {
    const d = logo()
    enamelPixels(d, W, W)
    expect(isWire(at(d, 0, 5))).toBe(true)                                 // outline
    expect(isWire(at(d, 5, 5))).toBe(true)                                 // red meets black two pixels away
    const field = at(d, 3, 5)                                              // inside the red field
    expect(isWire(field)).toBe(false)
    expect(hueGap(field[0], 0)).toBeLessThan(4)
  })

  it('colours become flat enamel of the same hue; black becomes gold, white becomes vellum', () => {
    const d = new Uint8ClampedArray(9 * 9 * 4)
    for (let i = 0; i < 81; i++) d.set([200, 30, 30, 255], i * 4)
    enamelPixels(d, 9, 9)
    const mid = toHsl([d[40 * 4], d[40 * 4 + 1], d[40 * 4 + 2]])           // centre, far from every edge
    expect(hueGap(mid[0], 0)).toBeLessThan(4)
    expect([0.4, 0.52, 0.66].some((l) => Math.abs(mid[2] - l) < 0.02)).toBe(true)
    const black = new Uint8ClampedArray(9 * 9 * 4).fill(0)
    for (let i = 0; i < 81; i++) black[i * 4 + 3] = 255
    enamelPixels(black, 9, 9)
    const g = toHsl([black[40 * 4], black[40 * 4 + 1], black[40 * 4 + 2]])
    expect(hueGap(g[0], 42)).toBeLessThan(6)
    expect(g[2]).toBeGreaterThan(0.6)
    const white = new Uint8ClampedArray(9 * 9 * 4).fill(255)
    enamelPixels(white, 9, 9)
    const v = toHsl([white[40 * 4], white[40 * 4 + 1], white[40 * 4 + 2]])
    expect(v[2]).toBeGreaterThan(0.85)
    expect(v[1]).toBeGreaterThan(0.2)                                      // cream, not pure white
  })
})

describe('which theme shows platform logos how', () => {
  it('neon only in Horyzont, enamel only in Kronika, EmuStart shows the logos as they are', async () => {
    const { themeById } = await import('../src/renderer/src/tv/themes')
    expect(themeById('sf').logoStyle).toBe('neon')
    expect(themeById('fantasy').logoStyle).toBe('enamel')
    expect(themeById('emustart').logoStyle).toBeUndefined()
  })
})
