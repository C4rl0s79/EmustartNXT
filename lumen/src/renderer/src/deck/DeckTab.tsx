import { useEffect, useRef, useState } from 'react'
import { api } from '../store'
import { SystemLogo } from '../tv/SystemLogo'
import { useGroupArt } from '../tv/GroupArt'
import { STEAM, type TvSystem } from '../tv/data'
import { fittedLogoHeight, logoReadable, steamFit, type Size } from './logoFit'

// One dock tab: the platform's logo — the same as the TV carousel shows (the server's logo, pixel art at
// whole zoom, Steam drawn locally, the group's own logo from Grafika grupy) — or its name, when the logo
// would be unreadable in this tab (logoFit.ts) or the tab has no library subgroup to describe it.

export function DeckTab({ sys, label, active, showLogos, onClick }: { sys?: TvSystem; label: string; active: boolean; showLogos: boolean; onClick: () => void }) {
  const own = useGroupArt(sys)
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<Size | null>(null)
  const [natural, setNatural] = useState<Size | null>(null)
  const name = <span className="deck-tab-name">{sys?.display ?? label}</span>

  const ownSrc = own.id && own.logo ? api().art.url(own.id, 'logo', own.rev, 'tv') : undefined
  const steam = !ownSrc && sys?.key === STEAM
  // the image SystemLogo will show (its rule: own logo, else the server's) — read for its natural size
  const src = !sys || !showLogos || steam ? undefined : (ownSrc ?? (sys.logo ? api().art.url(`emusys:${sys.key}`, 'logo', own.logo ? own.rev : sys.logoRev) : undefined))

  // the tab's content box (the logo's area); the tab is sized by the dock, never by its content
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize((s) => (s && s.w === e.contentRect.width && s.h === e.contentRect.height ? s : { w: e.contentRect.width, h: e.contentRect.height })))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // natural size of the logo, from the same address (cached by the page) — a new logo is a new address
  useEffect(() => {
    setNatural(null)
    if (!src) return
    let alive = true
    const img = new Image()
    img.onload = () => alive && setNatural({ w: img.naturalWidth, h: img.naturalHeight })
    img.src = src
    return () => {
      alive = false
    }
  }, [src])

  const pixel = ownSrc ? 0 : (sys?.logoPixel ?? 0)
  const steamMark = steam && size ? steamFit(size) : 'none'
  const fits = !size ? false : steam ? steamMark !== 'none' : !!natural && logoReadable(fittedLogoHeight(natural, size, pixel, window.devicePixelRatio || 1))

  return (
    <div ref={box} className={'deck-tab' + (active ? ' active' : '')} onClick={onClick} title={sys?.display ?? label}>
      {sys && showLogos && fits ? (
        <SystemLogo
          sysKey={sys.key}
          display={sys.display}
          hasLogo={sys.logo}
          rev={own.logo ? own.rev : sys.logoRev}
          pixel={sys.logoPixel}
          ownSrc={ownSrc}
          className={steam ? (steamMark === 'icon' ? 'deck-steam deck-steam--icon' : 'deck-steam') : undefined}
          fallback={name}
        />
      ) : (
        name
      )}
    </div>
  )
}
