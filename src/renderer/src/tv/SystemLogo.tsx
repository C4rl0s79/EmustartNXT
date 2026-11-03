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
// Pixel-art logos (the server keeps them at their native size, e.g. 32×32) are drawn only at a
// whole-number zoom: the largest 1×, 2×, 3×… that fits the logo area, so every art pixel is the same
// number of screen pixels (PixelLogo).

/** Largest whole-number zoom of a w×h image that fits a W×H area (at least 1×). */
export function pixelZoom(w: number, h: number, W: number, H: number): number {
  if (!w || !h) return 1
  return Math.max(1, Math.floor(Math.min(W / w, H / h)))
}

function PixelLogo({ src, onError }: { src: string; onError: () => void }) {
  const area = useRef<HTMLSpanElement>(null)
  const img = useRef<HTMLImageElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    const box = area.current
    const pic = img.current
    if (!box || !pic) return
    const fit = (): void => {
      const { naturalWidth: w, naturalHeight: h } = pic
      if (!w || !h) return
      const k = pixelZoom(w, h, box.clientWidth, box.clientHeight)
      setSize((s) => (s && s.w === w * k && s.h === h * k ? s : { w: w * k, h: h * k }))
    }
    pic.addEventListener('load', fit)
    if (pic.complete) fit()
    const ro = new ResizeObserver(fit) // the area changes with the window and the look editor's sizes
    ro.observe(box)
    return () => {
      pic.removeEventListener('load', fit)
      ro.disconnect()
    }
  }, [src])
  return (
    <span ref={area} className="sys-pixel">
      <img
        ref={img}
        src={src}
        alt=""
        draggable={false}
        onError={onError}
        style={size ? { width: size.w, height: size.h, maxWidth: 'none', maxHeight: 'none' } : { visibility: 'hidden' }}
      />
    </span>
  )
}

export function SystemLogo({
  sysKey,
  display,
  hasLogo,
  rev = 0,
  pixel = false,
  plate = false,
  className,
  fallback
}: {
  sysKey: string
  display: string
  hasLogo: boolean
  /** version of the server's logo (TvSystem.logoRev): a new logo is a new address, a failed one is tried again */
  rev?: number
  /** pixel-art logo at native size (TvSystem.logoPixel): whole-number zoom only */
  pixel?: boolean
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
        {pixel ? (
          <PixelLogo src={src} onError={() => setBroken(true)} />
        ) : (
          <img src={src} alt="" draggable={false} onError={() => setBroken(true)} />
        )}
      </span>
    )
  return plate ? <span className="sys-plate">{logo}</span> : <>{logo}</>
}
