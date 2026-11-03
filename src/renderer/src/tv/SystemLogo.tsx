import { useEffect, useState } from 'react'
import { api } from '../store'
import { SteamLogo } from '../components/SteamLogo'
import { STEAM } from './data'

// A platform's logo in the TV layout (carousel and the list header). The logo is always shown as its
// maker drew it (it reads well as it is, the EmuStart theme shows that); a theme joins it to its world
// by what it stands on: `plate` (themes.ts logoPlate) puts it on the theme's plate — a carved gilt
// cartouche in Kronika, a framed smoked-glass panel in Horyzont (tv.css .sys-plate, --tv-plate in the
// theme's stylesheet). Steam has no server logo (the server has no Steam platform) — it is drawn
// locally (SteamLogo).

export function SystemLogo({
  sysKey,
  display,
  hasLogo,
  rev = 0,
  plate = false,
  className,
  fallback
}: {
  sysKey: string
  display: string
  hasLogo: boolean
  /** version of the server's logo (TvSystem.logoRev): a new logo is a new address, a failed one is tried again */
  rev?: number
  plate?: boolean
  className?: string
  /** shown without a logo (or when it fails to load) */
  fallback: React.ReactNode
}) {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [sysKey, rev])
  let logo: React.ReactNode
  if (sysKey === STEAM) logo = <SteamLogo className={className} />
  else if (!hasLogo || broken) logo = fallback
  else
    logo = (
      <span className={`sys-logo ${className ?? ''}`} role="img" aria-label={display}>
        <img src={api().art.url(`emusys:${sysKey}`, 'logo', rev)} alt="" draggable={false} onError={() => setBroken(true)} />
      </span>
    )
  return plate ? <span className="sys-plate">{logo}</span> : <>{logo}</>
}
