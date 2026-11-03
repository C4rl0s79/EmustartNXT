// Platform logos in the TV themes' own crafts (themes.ts logoStyle), computed from the server's logo so
// new platforms need no drawing; the logo keeps its colours (a single-colour mask lost them and the
// inner shapes):
// - neon (Horyzont): dark parts such as black lettering become a light, tinted tube so they read on the
//   dark room, colours get brighter, a halo in the logo's characteristic hue goes around it (CSS --neon,
//   tv.css). No scanlines or flicker: the logos are read from the couch.
// - enamel (Kronika): cloisonné — flat enamel fields of the logo's colours separated by gold wire where
//   colours meet and along the outline; black and grey become gold, white becomes vellum.

import { toHsl } from './glow'

/** hue of a logo without colour (white, grey or black logos): Lumen's ice blue */
export const NEON_HUE = 192

function toRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number): number => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}

/**
 * The characteristic hue of a logo: the circular mean of the hues of its colourful pixels, weighted
 * by how colourful they are (dark, light and grey pixels skipped). null when nothing is colourful.
 */
export function dominantHue(data: Uint8ClampedArray): number | null {
  let x = 0
  let y = 0
  let w = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    const [h, s, l] = toHsl([data[i], data[i + 1], data[i + 2]])
    if (l < 0.12 || l > 0.92 || s < 0.2) continue
    const wt = s * (1 - Math.abs(l - 0.5))
    x += Math.cos((h * Math.PI) / 180) * wt
    y += Math.sin((h * Math.PI) / 180) * wt
    w += wt
  }
  if (!w) return null
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

/** Repaints the pixels (RGBA) as neon in place; returns the hue of the halo. */
export function neonPixels(data: Uint8ClampedArray): number {
  const hue = dominantHue(data) ?? NEON_HUE
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 8) continue
    const [h0, s0, l0] = toHsl([data[i], data[i + 1], data[i + 2]])
    // black and grey → a light tube tinted with the logo's hue (white stays white); colours → brighter
    const [h, s, l] = s0 < 0.15 ? [hue, 0.55 * (1 - l0), 0.74 + 0.26 * l0] : [h0, Math.min(1, s0 * 1.2 + 0.08), 0.46 + 0.5 * l0]
    const [r, g, b] = toRgb(h, s, l)
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
  }
  return hue
}

const GOLD_H = 42

/** gold from dark (0) to light (1) */
function gold(t: number): [number, number, number] {
  return toRgb(GOLD_H, 0.72 - 0.25 * t, 0.5 + 0.42 * t)
}

/** reach of the gold wire around an edge pixel (canvas pixels) */
const WIRE = [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2], [1, 1], [-1, -1], [1, -1], [-1, 1]]

/** Repaints the pixels (RGBA, w×h) as cloisonné enamel in place. */
export function enamelPixels(data: Uint8ClampedArray, w: number, h: number): void {
  const src = new Uint8ClampedArray(data)
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 8) continue
    const [h0, s0, l0] = toHsl([src[i], src[i + 1], src[i + 2]])
    const rgb =
      s0 < 0.15
        ? l0 > 0.85
          ? toRgb(44, 0.45, 0.9) // white → vellum
          : gold(0.35 + 0.5 * l0) // black and grey → gold
        : toRgb(h0, Math.min(1, s0 * 1.1 + 0.12), l0 < 0.38 ? 0.4 : l0 < 0.62 ? 0.52 : 0.66) // flat enamel
    data[i] = rgb[0]
    data[i + 1] = rgb[1]
    data[i + 2] = rgb[2]
  }
  // gold wire: the outline (transparent or outside next to it) and where the original colour changes
  const dist = (a: number, b: number): number =>
    Math.abs(src[a] - src[b]) + Math.abs(src[a + 1] - src[b + 1]) + Math.abs(src[a + 2] - src[b + 2])
  const wire = gold(0.85)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      if (src[i + 3] < 128) continue
      const edge = WIRE.some(([dx, dy]) => {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) return true
        const j = (ny * w + nx) * 4
        return src[j + 3] < 128 || dist(i, j) > 150
      })
      if (edge) {
        data[i] = wire[0]
        data[i + 1] = wire[1]
        data[i + 2] = wire[2]
        data[i + 3] = 255
      }
    }
  }
}

export type LogoStyle = 'neon' | 'enamel'

export interface StyledLogo {
  url: string
  /** neon: the hue of the halo */
  hue: number
}

const MAX_W = 640
const MAX_H = 240
const cache = new Map<string, Promise<StyledLogo | null>>()

/**
 * A logo image in a theme's craft (lumen-art answers with CORS, so the canvas can be read).
 * null when it cannot be computed — the logo is then shown as it is.
 */
export function styledLogo(src: string, style: LogoStyle): Promise<StyledLogo | null> {
  const key = `${style}|${src}`
  const hit = cache.get(key)
  if (hit) return hit
  const job = new Promise<StyledLogo | null>((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.onload = () => {
      try {
        const nw = img.naturalWidth || 400
        const nh = img.naturalHeight || 200
        const scale = Math.min(2, MAX_W / nw, MAX_H / nh)
        const c = document.createElement('canvas')
        c.width = Math.max(1, Math.round(nw * scale))
        c.height = Math.max(1, Math.round(nh * scale))
        const ctx = c.getContext('2d', { willReadFrequently: true })
        if (!ctx) return resolve(null)
        ctx.drawImage(img, 0, 0, c.width, c.height)
        const id = ctx.getImageData(0, 0, c.width, c.height)
        let hue = NEON_HUE
        if (style === 'neon') hue = neonPixels(id.data)
        else enamelPixels(id.data, c.width, c.height)
        ctx.putImageData(id, 0, 0)
        resolve({ url: c.toDataURL('image/png'), hue })
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = src
  })
  cache.set(key, job)
  return job
}
