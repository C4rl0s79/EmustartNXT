import { useState } from 'react'
import { api } from '../store'
import { SteamLogo } from '../components/SteamLogo'
import { STEAM } from './data'

// A platform's logo in the TV layout (carousel and the list header). Themes with logo tint repaint it
// in their own material: the server's logo becomes a mask filled with the theme's --tv-logo-fill (gold
// in Kronika, ice in Horyzont), so every platform matches the theme while keeping its own shape.
// Steam has no server logo (the server has no Steam platform) — it is drawn locally (SteamLogo).

export function SystemLogo({
  sysKey,
  display,
  hasLogo,
  tint,
  className,
  fallback
}: {
  sysKey: string
  display: string
  hasLogo: boolean
  tint: boolean
  className?: string
  /** shown without a logo (or when it fails to load) */
  fallback: React.ReactNode
}) {
  const [broken, setBroken] = useState(false)
  if (sysKey === STEAM) return <SteamLogo className={`${className ?? ''} ${tint ? 'is-tinted' : ''}`} />
  if (!hasLogo || broken) return <>{fallback}</>
  const src = api().art.url(`emusys:${sysKey}`, 'logo')
  return (
    <span className={`sys-logo ${tint ? 'is-tinted' : ''} ${className ?? ''}`} role="img" aria-label={display}>
      {/* the image itself: shown as is, or kept (invisible) to size the box and report a broken logo */}
      <img src={src} alt="" draggable={false} onError={() => setBroken(true)} />
      {tint && <span className="sys-logo__fill" style={{ maskImage: `url("${src}")`, WebkitMaskImage: `url("${src}")` }} />}
    </span>
  )
}
