import { useEffect, useRef, useState } from 'react'
import { api } from '../store'
import { SteamLogo } from '../components/SteamLogo'
import { STEAM } from './data'

// A platform's logo in the TV layout (carousel and the list header). The logo is always shown as its
// maker drew it (it reads well as it is, the EmuStart theme shows that); a theme joins it to its world
// by what it stands on: `plate` (themes.ts logoPlate) puts it on the theme's plate — a carved gilt
// cartouche in Kronika, a framed smoked-glass panel in Horyzont (tv.css .sys-plate, --tv-plate in the
// theme's stylesheet). Steam has no server logo (the server has no Steam platform) — it is drawn
// locally (SteamLogo).
// Pixel-art logos (the server tells the size of one art pixel in the file: 8 for RetroArch dot-art, 1 for
// native pixel art) are drawn only at a whole-number zoom of the art pixels, counted in device pixels: the
// largest 1×, 2×, 3×… that fits the logo area, so every art pixel is the same number of screen pixels —
// also with Windows display scaling (PixelLogo).

/** Largest whole-number zoom of a w×h image that fits a W×H area (at least 1×). */
export function pixelZoom(w: number, h: number, W: number, H: number): number {
  if (!w || !h) return 1
  return Math.max(1, Math.floor(Math.min(W / w, H / h)))
}

/**
 * Size in CSS pixels of a pixel-art image (natural nw×nh, one art pixel = `block` file pixels) inside a W×H
 * CSS-pixel area: every art pixel is k whole device pixels (k ≥ 1).
 */
export function pixelSize(nw: number, nh: number, block: number, W: number, H: number, dpr: number): { w: number; h: number } {
  const aw = nw / block
  const ah = nh / block
  const k = pixelZoom(aw, ah, W * dpr, H * dpr)
  return { w: (aw * k) / dpr, h: (ah * k) / dpr }
}

function PixelLogo({ src, block, onError }: { src: string; block: number; onError: () => void }) {
  const area = useRef<HTMLSpanElement>(null)
  const img = useRef<HTMLImageElement>(null)
  const [size, setSize] = useState<{ w: number; h: number; x: number; y: number } | null>(null)
  useEffect(() => {
    const box = area.current
    const pic = img.current
    if (!box || !pic) return
    const fit = (): void => {
      const { naturalWidth: nw, naturalHeight: nh } = pic
      if (!nw || !nh) return
      const dpr = window.devicePixelRatio || 1
      const { w, h } = pixelSize(nw, nh, Math.max(1, block), box.clientWidth, box.clientHeight, dpr)
      // centred (on the left in the list header), on a whole device pixel — a half-pixel offset would make
      // the art pixels uneven
      const left = getComputedStyle(box).textAlign === 'left'
      const x = left ? 0 : Math.round(((box.clientWidth - w) / 2) * dpr) / dpr
      const y = Math.round(((box.clientHeight - h) / 2) * dpr) / dpr
      setSize((s) => (s && s.w === w && s.h === h && s.x === x && s.y === y ? s : { w, h, x, y }))
    }
    pic.addEventListener('load', fit)
    if (pic.complete) fit()
    const ro = new ResizeObserver(fit) // the area changes with the window and the look editor's sizes
    ro.observe(box)
    return () => {
      pic.removeEventListener('load', fit)
      ro.disconnect()
    }
  }, [src, block])
  return (
    <span ref={area} className="sys-pixel">
      <img
        ref={img}
        src={src}
        alt=""
        draggable={false}
        onError={onError}
        style={
          size
            ? { width: size.w, height: size.h, left: size.x, top: size.y, maxWidth: 'none', maxHeight: 'none' }
            : { visibility: 'hidden' }
        }
      />
    </span>
  )
}

export function SystemLogo({
  sysKey,
  display,
  hasLogo,
  rev = 0,
  pixel = 0,
  plate = false,
  className,
  fallback
}: {
  sysKey: string
  display: string
  hasLogo: boolean
  /** version of the server's logo (TvSystem.logoRev): a new logo is a new address, a failed one is tried again */
  rev?: number
  /** pixel-art logo (TvSystem.logoPixel): size of an art pixel in file pixels; 0 — an ordinary logo */
  pixel?: number
  plate?: boolean
  className?: string
  /** shown without a logo (or when it fails to load) */
  fallback: React.ReactNode
}) {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [sysKey, rev])
  let logo: React.ReactNode
  const src = api().art.url(`emusys:${sysKey}`, 'logo', rev)
  if (sysKey === STEAM) logo = <SteamLogo className={className} />
  else if (!hasLogo || broken) logo = fallback
  else
    logo = (
      <span className={`sys-logo ${className ?? ''}`} role="img" aria-label={display}>
        {pixel > 0 ? (
          <PixelLogo src={src} block={pixel} onError={() => setBroken(true)} />
        ) : (
          <img src={src} alt="" draggable={false} onError={() => setBroken(true)} />
        )}
      </span>
    )
  return plate ? <span className="sys-plate">{logo}</span> : <>{logo}</>
}
