import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ACCENTS, BACKS } from '../src/renderer/src/tv/look'
import { contrast } from '../src/renderer/src/tv/themes'

// The selected row / menu item (tv.css) is a gradient from --tv-sel-start (the accent darkened in oklab) to
// --tv-accent-soft (the accent at 35% over the background), with white text on it. Both ends must keep
// 4.5:1 for every accent and background the look editor offers.
const css = readFileSync(path.join(__dirname, '../src/renderer/src/tv/tv.css'), 'utf8')
const darken = Number(css.match(/--tv-sel-start:\s*color-mix\(in oklab, var\(--tv-accent\), black (\d+)%\)/)?.[1])
const soft = Number(css.match(/--tv-accent-soft:\s*color-mix\(in srgb, var\(--tv-accent\) (\d+)%, transparent\)/)?.[1])

const hex = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
const toHex = (c: number[]): string =>
  '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')
const lin = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const gam = (v: number): number => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)

// sRGB → oklab → L, a, b scaled toward black (color-mix with black = mixing with oklab 0,0,0) → sRGB
function mixBlack(h: string, pct: number): string {
  const [r, g, b] = hex(h).map(lin)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const k = 1 - pct / 100
  const L = (0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s) * k
  const A = (1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s) * k
  const B = (0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s) * k
  const l2 = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m2 = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s2 = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  return toHex(
    [
      4.0767416621 * l2 - 3.3077115913 * m2 + 0.2309699292 * s2,
      -1.2684380046 * l2 + 2.6097574011 * m2 - 0.3413193965 * s2,
      -0.0041960863 * l2 - 0.7034186147 * m2 + 1.707614701 * s2
    ].map(gam)
  )
}
const over = (fg: string, alpha: number, bg: string): string => {
  const [f, b] = [hex(fg), hex(bg)]
  return toHex(f.map((v, i) => v * alpha + b[i] * (1 - alpha)))
}

describe('selected row contrast (EmuStart theme, menus)', () => {
  it('reads the mix percentages from tv.css', () => {
    expect(darken).toBeGreaterThan(0)
    expect(soft).toBeGreaterThan(0)
  })
  it('the oklab darkening matches the browser (blue accent, measured in Lumen: 6.33:1)', () => {
    expect(contrast(mixBlack('#4f8cff', 25), '#ffffff')).toBeCloseTo(6.33, 1)
  })
  it.each(ACCENTS.map(([c, name]) => [name, c]))('%s: both ends of the bar keep 4.5:1 with white', (_name, accent) => {
    expect(contrast(mixBlack(accent, darken), '#ffffff')).toBeGreaterThanOrEqual(4.5)
    for (const [bg] of Object.values(BACKS)) expect(contrast(over(accent, soft / 100, bg), '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })
})
