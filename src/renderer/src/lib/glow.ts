// "Lightbox": in the desktop layout the only colour comes from the games. The light of the selected
// game — a colour sampled from its art — becomes the accent (focus ring, play button, ambient glow).
// It is normalised so it always works as a light: bright enough on the dark room (≥ 3:1) and with
// dark ink on it (≥ 4.5:1), never grey, never neon.

export const DEFAULT_GLOW = '#f2c879' // warm lamplight, when a game has no art or no colour
export const GLOW_INK = '#121214'

type Rgb = [number, number, number]

function toHsl([r, g, b]: Rgb): [number, number, number] {
  const R = r / 255
  const G = g / 255
  const B = b / 255
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4
  return [h * 60, s, l]
}

function fromHsl(h: number, s: number, l: number): string {
  const k = (n: number): number => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')
}

/**
 * A sampled colour turned into a usable light: hue kept, saturation 0.45–0.85, lightness 0.72.
 * A greyish sample (saturation under 0.12) has no hue worth keeping — the default light is used.
 */
export function normalizeGlow(rgb: Rgb): string {
  const [h, s] = toHsl(rgb)
  if (s < 0.12) return DEFAULT_GLOW
  return fromHsl(h, Math.min(0.85, Math.max(0.45, s)), 0.72)
}

/**
 * The characteristic colour of an image: the average of its colourful pixels (dark, light and grey
 * ones are skipped), weighted by how colourful they are. Returns null when nothing is colourful.
 */
export function dominantColor(data: Uint8ClampedArray): Rgb | null {
  let r = 0
  let g = 0
  let b = 0
  let w = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    const px: Rgb = [data[i], data[i + 1], data[i + 2]]
    const [, s, l] = toHsl(px)
    if (l < 0.12 || l > 0.92 || s < 0.2) continue
    const weight = s * (1 - Math.abs(l - 0.5))
    r += px[0] * weight
    g += px[1] * weight
    b += px[2] * weight
    w += weight
  }
  return w > 0 ? [r / w, g / w, b / w] : null
}

const cache = new Map<string, string>()

/** The light of one image (lumen-art answers with CORS, so the canvas can be read). */
export function glowOf(url: string): Promise<string> {
  const hit = cache.get(url)
  if (hit) return Promise.resolve(hit)
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.onload = () => {
      let out = DEFAULT_GLOW
      try {
        const c = document.createElement('canvas')
        c.width = 24
        c.height = 24
        const ctx = c.getContext('2d', { willReadFrequently: true })
        if (ctx) {
          ctx.drawImage(img, 0, 0, 24, 24)
          const rgb = dominantColor(ctx.getImageData(0, 0, 24, 24).data)
          if (rgb) out = normalizeGlow(rgb)
        }
      } catch {
        /* unreadable image: the default light */
      }
      if (cache.size > 500) cache.delete(cache.keys().next().value!)
      cache.set(url, out)
      resolve(out)
    }
    img.onerror = () => resolve(DEFAULT_GLOW)
    img.src = url
  })
}

let wanted = ''
/** Lights the room with this image's colour (the last call wins when several are in flight). */
export function setGlowFrom(url: string | null): void {
  wanted = url ?? ''
  if (!url) return applyGlow(DEFAULT_GLOW)
  void glowOf(url).then((c) => {
    if (wanted === url) applyGlow(c)
  })
}

function applyGlow(c: string): void {
  document.documentElement.style.setProperty('--glow', c)
}

/**
 * Desktop layout: the focused poster (or the open game) lights the room. Installed once by the app;
 * returns the cleanup.
 */
export function installGlow(artUrl: (gameId: string) => string): () => void {
  let t: ReturnType<typeof setTimeout> | undefined
  const onFocus = (e: FocusEvent): void => {
    const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>('.poster[data-key]')
    if (!el) return
    clearTimeout(t)
    // moving fast through a grid: only where the focus settles
    t = setTimeout(() => setGlowFrom(artUrl(el.dataset.key!)), 120)
  }
  document.addEventListener('focusin', onFocus)
  return () => {
    clearTimeout(t)
    document.removeEventListener('focusin', onFocus)
  }
}
