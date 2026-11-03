import { useEffect, useState } from 'react'
import { api } from '../store'
import { SteamLogo } from '../components/SteamLogo'
import { NEON_HUE, neonLogo, type NeonLogo } from '../lib/neonLogo'
import { STEAM } from './data'

// A platform's logo in the TV layout (carousel and the list header), as retro neon in every theme:
// the server's logo with its own colours, dark parts lit up and a halo in its characteristic hue
// (lib/neonLogo.ts, tv.css --neon). Steam has no server logo (the server has no Steam platform) — it is
// drawn locally (SteamLogo) and glows in Steam's blue.

const STEAM_HUE = 202

export function SystemLogo({
  sysKey,
  display,
  hasLogo,
  className,
  fallback
}: {
  sysKey: string
  display: string
  hasLogo: boolean
  className?: string
  /** shown without a logo (or when it fails to load) */
  fallback: React.ReactNode
}) {
  const [broken, setBroken] = useState(false)
  const src = sysKey !== STEAM && hasLogo ? api().art.url(`emusys:${sysKey}`, 'logo') : ''
  // undefined: being computed; null: cannot be computed (the logo as it is, default halo)
  const [neon, setNeon] = useState<NeonLogo | null | undefined>(undefined)
  useEffect(() => {
    if (!src) return
    let alive = true
    setNeon(undefined)
    void neonLogo(src).then((n) => alive && setNeon(n))
    return () => {
      alive = false
    }
  }, [src])
  const glow = (hue: number): React.CSSProperties =>
    ({ '--neon': `hsl(${hue} 95% 62%)`, '--neon-soft': `hsl(${hue} 95% 55% / 0.45)` }) as React.CSSProperties
  if (sysKey === STEAM) return <SteamLogo className={`${className ?? ''} neon-glow`} style={glow(STEAM_HUE)} />
  if (!hasLogo || broken) return <>{fallback}</>
  return (
    <span className={`sys-logo neon-glow ${className ?? ''}`} role="img" aria-label={display} style={glow(neon?.hue ?? NEON_HUE)}>
      {/* hidden until the neon version is ready (no flash of the plain logo); the original reports a broken logo */}
      <img
        src={neon ? neon.url : src}
        alt=""
        draggable={false}
        style={neon === undefined ? { visibility: 'hidden' } : undefined}
        onError={() => setBroken(true)}
      />
    </span>
  )
}
