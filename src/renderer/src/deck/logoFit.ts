import { pixelSize } from '../tv/SystemLogo'

// Does a platform logo fit a dock tab? Computed from the logo's natural size and the tab's content box —
// not measured from the drawn image (a pixel-art logo is sized by PixelLogo after load, Steam is an SVG).
// Logos are very wide (3:1 to 9:1): fitted in both dimensions, and below MIN_LOGO_H the tab shows the
// platform's name instead (PyLinksDeck dock.py).

export const MIN_LOGO_H = 11

export interface Size {
  w: number
  h: number
}

/**
 * Height the logo gets in the box (CSS px), 0 when it does not fit at all. Pixel art (`pixel` = file
 * pixels per art pixel) is drawn only at a whole zoom ≥ 1× (PixelLogo): wider than the box at 1× → 0.
 */
export function fittedLogoHeight(natural: Size, box: Size, pixel: number, dpr: number): number {
  if (!natural.w || !natural.h || box.w <= 0 || box.h <= 0) return 0
  if (pixel > 0) {
    const { w, h } = pixelSize(natural.w, natural.h, pixel, box.w, box.h, dpr)
    return w <= box.w + 0.5 && h <= box.h + 0.5 ? h : 0
  }
  return Math.min(box.h, (box.w * natural.h) / natural.w)
}

/** Steam's mark is drawn locally, sized by font-size — the same formula as deck.css `.deck-steam`. */
export function steamFontSize(box: Size): number {
  return Math.min(box.h * 0.48, box.w * 0.15)
}

export const logoReadable = (height: number): boolean => height >= MIN_LOGO_H
