import { describe, expect, it } from 'vitest'
import { MIN_LOGO_H, fittedLogoHeight, logoReadable, steamFit, steamFontSize } from '../src/renderer/src/deck/logoFit'

describe('fittedLogoHeight', () => {
  it('fits a wide logo in both dimensions of the tab', () => {
    // 9:1 logo, 36 px high tab: the width limits it
    expect(fittedLogoHeight({ w: 900, h: 100 }, { w: 180, h: 36 }, 0, 1)).toBe(20)
    // 3:1 logo in a wide tab: the height limits it
    expect(fittedLogoHeight({ w: 300, h: 100 }, { w: 400, h: 36 }, 0, 1)).toBe(36)
  })

  it('a 9:1 logo in a narrow tab comes out below the readable height — the tab shows the name', () => {
    const h = fittedLogoHeight({ w: 900, h: 100 }, { w: 90, h: 36 }, 0, 1)
    expect(h).toBe(10)
    expect(logoReadable(h)).toBe(false)
    expect(MIN_LOGO_H).toBe(11)
  })

  it('pixel art: the whole zoom PixelLogo draws, counted in device pixels', () => {
    // 8× dot-art 960×160 file = 120×20 art px; tab 250×36 at 1× → zoom 1 (2× would be 40 high) → 20 px
    expect(fittedLogoHeight({ w: 960, h: 160 }, { w: 250, h: 36 }, 8, 1)).toBe(20)
    // at 150 % scaling: 375×54 device px → zoom 2 → 40 device px = 26.67 CSS px
    expect(fittedLogoHeight({ w: 960, h: 160 }, { w: 250, h: 36 }, 8, 1.5)).toBeCloseTo(26.67, 1)
  })

  it('pixel art wider than the tab at 1× does not fit at all (PixelLogo never shrinks below 1×)', () => {
    expect(fittedLogoHeight({ w: 960, h: 160 }, { w: 70, h: 36 }, 8, 1)).toBe(0)
  })

  it('no logo size or an empty tab → 0', () => {
    expect(fittedLogoHeight({ w: 0, h: 0 }, { w: 200, h: 36 }, 0, 1)).toBe(0)
    expect(fittedLogoHeight({ w: 300, h: 100 }, { w: 0, h: 36 }, 0, 1)).toBe(0)
  })
})

describe('Steam in a tab', () => {
  it('the full mark fills the tab width (icon + wordmark ≈ 5.1 em, 92 %), judged by the icon height like other logos', () => {
    expect(steamFontSize({ w: 400, h: 36 })).toBeCloseTo(17.28)
    expect(steamFit({ w: 400, h: 36 })).toBe('full')
    // 60 px tab: 10.8 px font → 12.7 px icon — readable, as a 3:1 logo (20 px) is
    expect(steamFit({ w: 60, h: 36 })).toBe('full')
  })

  it('a tab too narrow for the wordmark draws the icon alone; only a tiny tab gets the name', () => {
    expect(steamFit({ w: 45, h: 36 })).toBe('icon')
    expect(steamFit({ w: 12, h: 36 })).toBe('none')
  })
})
