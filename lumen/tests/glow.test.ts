import { describe, expect, it } from 'vitest'
import { DEFAULT_GLOW, GLOW_INK, dominantColor, normalizeGlow } from '../src/renderer/src/lib/glow'
import { contrast } from '../src/renderer/src/tv/themes'

const ROOM = '#101114'

describe('Lightbox: the light from the games', () => {
  it('every hue becomes a usable light: ≥ 3:1 on the room, dark ink on it ≥ 4.5:1', () => {
    for (let h = 0; h < 360; h += 15) {
      // a saturated colour of hue h, from very dark to very light samples
      for (const [r, g, b] of [
        [Math.round(127 + 127 * Math.cos((h * Math.PI) / 180)), Math.round(127 + 127 * Math.cos(((h - 120) * Math.PI) / 180)), Math.round(127 + 127 * Math.cos(((h + 120) * Math.PI) / 180))],
        [40, 10, 90],
        [250, 240, 120]
      ] as [number, number, number][]) {
        const c = normalizeGlow([r, g, b])
        expect(contrast(c, ROOM), `${c} on room`).toBeGreaterThanOrEqual(3)
        expect(contrast(GLOW_INK, c), `ink on ${c}`).toBeGreaterThanOrEqual(4.5)
      }
    }
    expect(contrast(DEFAULT_GLOW, ROOM)).toBeGreaterThanOrEqual(3)
  })

  it('a grey sample keeps the default light; colourful pixels decide the colour', () => {
    expect(normalizeGlow([128, 128, 130])).toBe(DEFAULT_GLOW)
    // black and white pixels are ignored, the red ones count
    const px = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 200, 30, 30, 255, 210, 40, 40, 255])
    const rgb = dominantColor(px)!
    expect(rgb[0]).toBeGreaterThan(190)
    expect(rgb[1]).toBeLessThan(50)
    expect(dominantColor(new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]))).toBeNull()
  })
})
