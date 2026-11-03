import { useEffect, useState } from 'react'
import { api } from '../store'
import { SteamLogo } from '../components/SteamLogo'
import { NEON_HUE, styledLogo, type LogoStyle, type StyledLogo } from '../lib/logoStyles'
import { STEAM } from './data'

// A platform's logo in the TV layout (carousel and the list header), in the theme's craft
// (themes.ts logoStyle, lib/logoStyles.ts), always keeping the logo's own colours:
// - none: as it is (EmuStart);
// - neon (Horyzont): retro neon, dark parts lit up, a halo in its characteristic hue (tv.css --neon);
// - enamel (Kronika): cloisonné, flat colour fields in gold wire (fantasy.css relief).
// Steam has no server logo (the server has no Steam platform) — it is drawn locally (SteamLogo): it
// glows in Steam's blue in neon and is struck in gold (--tv-logo-fill) in enamel; it has no colours to keep.

const STEAM_HUE = 202

const glow = (hue: number): React.CSSProperties =>
  ({ '--neon': `hsl(${hue} 95% 62%)`, '--neon-soft': `hsl(${hue} 95% 55% / 0.45)` }) as React.CSSProperties

export function SystemLogo({
  sysKey,
  display,
  hasLogo,
  look,
  className,
  fallback
}: {
  sysKey: string
  display: string
  hasLogo: boolean
  look?: LogoStyle
  className?: string
  /** shown without a logo (or when it fails to load) */
  fallback: React.ReactNode
}) {
  const [broken, setBroken] = useState(false)
  const src = sysKey !== STEAM && hasLogo ? api().art.url(`emusys:${sysKey}`, 'logo') : ''
  // undefined: being computed; null: cannot be computed (the logo as it is)
  const [styled, setStyled] = useState<StyledLogo | null | undefined>(undefined)
  useEffect(() => {
    if (!look || !src) return
    let alive = true
    setStyled(undefined)
    void styledLogo(src, look).then((s) => alive && setStyled(s))
    return () => {
      alive = false
    }
  }, [look, src])
  if (sysKey === STEAM) {
    if (look === 'neon') return <SteamLogo className={`${className ?? ''} neon-glow`} style={glow(STEAM_HUE)} />
    return <SteamLogo className={`${className ?? ''} ${look === 'enamel' ? 'is-tinted' : ''}`} />
  }
  if (!hasLogo || broken) return <>{fallback}</>
  if (!look)
    return (
      <span className={`sys-logo ${className ?? ''}`} role="img" aria-label={display}>
        <img src={src} alt="" draggable={false} onError={() => setBroken(true)} />
      </span>
    )
  return (
    <span
      className={`sys-logo ${look === 'neon' ? 'neon-glow' : 'is-enamel'} ${className ?? ''}`}
      role="img"
      aria-label={display}
      style={look === 'neon' ? glow(styled?.hue ?? NEON_HUE) : undefined}
    >
      {/* hidden until the theme's version is ready (no flash of the plain logo); the original reports a broken logo */}
      <img
        src={styled ? styled.url : src}
        alt=""
        draggable={false}
        style={styled === undefined ? { visibility: 'hidden' } : undefined}
        onError={() => setBroken(true)}
      />
    </span>
  )
}
