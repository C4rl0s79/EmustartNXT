// Platform logos as retro neon, in every TV theme. The logo keeps its own colours (a single-colour
// mask lost them and the inner shapes); dark parts such as black lettering become a light, tinted
// tube so they read on the dark room, colours get brighter, and a halo in the logo's characteristic
// hue goes around it (CSS --neon, tv.css). Computed from the server's logo, so new platforms need
// no drawing. No scanlines or flicker: the logos are read from the couch.

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

export interface NeonLogo {
  url: string
  hue: number
}

const MAX_W = 640
const MAX_H = 240
const cache = new Map<string, Promise<NeonLogo | null>>()

/**
 * The neon version of a logo image (lumen-art answers with CORS, so the canvas can be read).
 * null when it cannot be computed — the logo is then shown as it is, with the default halo.
 */
export function neonLogo(src: string): Promise<NeonLogo | null> {
  const hit = cache.get(src)
  if (hit) return hit
  const job = new Promise<NeonLogo | null>((resolve) => {
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
        const hue = neonPixels(id.data)
        ctx.putImageData(id, 0, 0)
        resolve({ url: c.toDataURL('image/png'), hue })
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = src
  })
  cache.set(src, job)
  return job
}
