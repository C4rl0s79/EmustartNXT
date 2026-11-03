import { useEffect, useState } from 'react'
import { api } from '../store'
import { SteamLogo } from '../components/SteamLogo'
import { NEON_HUE, neonLogo, type NeonLogo } from '../lib/neonLogo'
import { STEAM } from './data'

// A platform's logo in the TV layout (carousel and the list header), as the theme wants it:
// - as it is (EmuStart);
// - tint: repainted in the theme's material — the server's logo becomes a mask filled with the
//   theme's --tv-logo-fill (gold in Kronika), every platform matches the theme while keeping its shape;
// - neon: retro neon in its own colours, dark parts lit up and a halo in its characteristic hue
//   (Horyzont; lib/neonLogo.ts, tv.css --neon).
// Steam has no server logo (the server has no Steam platform) — it is drawn locally (SteamLogo).

const STEAM_HUE = 202

const glow = (hue: number): React.CSSProperties =>
  ({ '--neon': `hsl(${hue} 95% 62%)`, '--neon-soft': `hsl(${hue} 95% 55% / 0.45)` }) as React.CSSProperties

export function SystemLogo({
  sysKey,
  display,
  hasLogo,
  tint,
  neon = false,
  className,
  fallback
}: {
  sysKey: string
  display: string
  hasLogo: boolean
  tint: boolean
  neon?: boolean
  className?: string
  /** shown without a logo (or when it fails to load) */
  fallback: React.ReactNode
}) {
  const [broken, setBroken] = useState(false)
  const src = sysKey !== STEAM && hasLogo ? api().art.url(`emusys:${sysKey}`, 'logo') : ''
  // undefined: being computed; null: cannot be computed (the logo as it is, default halo)
  const [lit, setLit] = useState<NeonLogo | null | undefined>(undefined)
  useEffect(() => {
    if (!neon || !src) return
    let alive = true
    setLit(undefined)
    void neonLogo(src).then((n) => alive && setLit(n))
    return () => {
      alive = false
    }
  }, [neon, src])
  if (sysKey === STEAM) {
    if (neon) return <SteamLogo className={`${className ?? ''} neon-glow`} style={glow(STEAM_HUE)} />
    return <SteamLogo className={`${className ?? ''} ${tint ? 'is-tinted' : ''}`} />
  }
  if (!hasLogo || broken) return <>{fallback}</>
  if (neon)
    return (
      <span className={`sys-logo neon-glow ${className ?? ''}`} role="img" aria-label={display} style={glow(lit?.hue ?? NEON_HUE)}>
        {/* hidden until the neon version is ready (no flash of the plain logo); the original reports a broken logo */}
        <img
          src={lit ? lit.url : src}
          alt=""
          draggable={false}
          style={lit === undefined ? { visibility: 'hidden' } : undefined}
          onError={() => setBroken(true)}
        />
      </span>
    )
  return (
    <span className={`sys-logo ${tint ? 'is-tinted' : ''} ${className ?? ''}`} role="img" aria-label={display}>
      {/* the image itself: shown as is, or kept (invisible) to size the box and report a broken logo */}
      <img src={src} alt="" draggable={false} onError={() => setBroken(true)} />
      {tint && <span className="sys-logo__fill" style={{ maskImage: `url("${src}")`, WebkitMaskImage: `url("${src}")` }} />}
    </span>
  )
}
