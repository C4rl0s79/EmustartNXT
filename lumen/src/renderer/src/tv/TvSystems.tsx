import { useEffect, useState, type CSSProperties } from 'react'
import { categoryArt, useThemePkg } from './themeArt'
import type { EmuSystemInfo } from '@shared/types'
import { api } from '../store'
import { useActions } from '../nav/input'
import { STEAM, systemMeta, type TvSystem } from './data'
import { SystemOptions } from '../components/SystemOptions'
import { SystemLogo } from './SystemLogo'
import { GroupArtOptions, groupArtId, useGroupArt } from './GroupArt'
import { carouselGap, useLook } from './look'

// System carousel (EmuStart look): the selected platform's logo in the middle, neighbours smaller
// and dimmed, the carousel wraps around; below — name, counts and the platform description.

const info: Record<string, EmuSystemInfo> = {}

const STEAM_INFO: EmuSystemInfo = {
  manufacturer: 'Valve',
  description: 'Gry z biblioteki Steam. Instalacją, aktualizacjami, uruchamianiem i synchronizacją zapisów (Steam Cloud) zarządza klient Steam.'
}

function useSystemInfo(sys: TvSystem | undefined): EmuSystemInfo | null {
  const [d, setD] = useState<EmuSystemInfo | null>(null)
  useEffect(() => {
    if (!sys) return setD(null)
    if (sys.key === STEAM) return setD(STEAM_INFO)
    // a library group (PC, Konsole, GOG…): its own short description, nothing asked from the engine
    if (!sys.es) return setD(sys.about ? { description: sys.about } : null)
    if (info[sys.key]) return setD(info[sys.key])
    setD(null)
    let alive = true
    let tries = 0
    let timer: ReturnType<typeof setTimeout>
    const load = async (): Promise<void> => {
      const r = await api()
        .emustart.systemInfo(sys.key)
        .catch(() => null)
      if (!alive || !r) return
      if (r.pending) {
        if (++tries < 40) timer = setTimeout(() => void load(), 1500)
        return
      }
      info[sys.key] = r
      setD(r)
    }
    timer = setTimeout(() => void load(), 250)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [sys])
  return d
}

/** The platform's console photo behind the carousel (the theme's tone; bright consoles toned down by lum). */
function ConsoleBackdrop({ sys, photos }: { sys: TvSystem; photos: boolean }) {
  const [broken, setBroken] = useState(false)
  const own = useGroupArt(sys)
  const themed = categoryArt(useThemePkg(), sys, 'hero')
  useEffect(() => setBroken(false), [sys.key, sys.consoleRev, own.rev, own.hero, themed])
  // grafika z motywu (etap 14d): po własnej grafice gracza, przed domyślną z serwera i zdjęciem konsoli
  if (themed && !own.own.hero && !broken)
    return (
      <div key={sys.key} className="tv-console" aria-hidden="true" style={{ '--con-lum': 0.5 } as CSSProperties}>
        <img decoding="async" src={themed} alt="" draggable={false} onError={() => setBroken(true)} />
      </div>
    )
  if (!photos) return null
  if (own.id && own.hero && !broken)
    return (
      <div key={sys.key} className="tv-console" aria-hidden="true" style={{ '--con-lum': 0.5 } as CSSProperties}>
        <img decoding="async" src={api().art.url(own.id, 'hero', own.rev, 'tv')} alt="" draggable={false} onError={() => setBroken(true)} />
      </div>
    )
  if (!sys.console || broken) return null
  return (
    <div key={sys.key} className="tv-console" aria-hidden="true" style={{ '--con-lum': sys.console.lum } as CSSProperties}>
      <img decoding="async" src={api().art.url(`emusys:${sys.key}`, 'hero', sys.consoleRev)} alt="" draggable={false} onError={() => setBroken(true)} />
    </div>
  )
}

function SysCard({ sys, d, gap, plate }: { sys: TvSystem; d: number; gap: number; plate: boolean }) {
  const ad = Math.abs(d)
  const own = useGroupArt(sys)
  const themedLogo = categoryArt(useThemePkg(), sys, 'logo')
  return (
    <div
      className={`tv-syscard ${ad === 0 ? 'is-current' : ''}`}
      style={{
        transform: `translate(calc(-50% + ${d * gap}vw), -50%) scale(${ad === 0 ? 1 : 0.55})`,
        opacity: ad === 0 ? 1 : ad <= 2 ? 0.45 : 0,
        filter: ad === 0 ? 'none' : 'grayscale(.6)',
        zIndex: 10 - ad
      }}
    >
      <SystemLogo
        sysKey={sys.key}
        display={sys.display}
        hasLogo={sys.logo}
        rev={own.logo ? own.rev : sys.logoRev}
        pixel={sys.logoPixel}
        plate={plate}
        ownSrc={themedLogo && !own.own.logo ? themedLogo : own.id && own.logo ? api().art.url(own.id, 'logo', own.rev, 'tv') : undefined}
        className={sys.key === STEAM ? 'tv-syslogo-steam' : 'tv-syslogo'}
        fallback={<div className="txt">{sys.display}</div>}
      />
    </div>
  )
}

export function TvSystems({
  systems,
  index,
  onIndex,
  onOpen,
  onMenu,
  active,
  logoPlate,
  consoleBackdrop,
  onBack,
  pin,
  title
}: {
  systems: TvSystem[]
  index: number
  onIndex: (i: number) => void
  onOpen: () => void
  onMenu: () => void
  active: boolean
  /** platform logos on the theme's plate (themes.ts logoPlate) */
  logoPlate: boolean
  /** the console photo behind the carousel (themes.ts consoleBackdrop) */
  consoleBackdrop: boolean
  /** B: one level up (subgroups → groups); absent on the first level */
  onBack?: () => void
  /** Y: pin / unpin the selected subgroup for quick access */
  pin?: { pinned: (s: TvSystem) => boolean; toggle: (s: TvSystem) => void; can: (s: TvSystem) => boolean }
  /** name of the group whose subgroups are shown */
  title?: string
}) {
  const n = systems.length
  const sys = systems[index]
  const d = useSystemInfo(sys)
  const [opts, setOpts] = useState(false)
  const gap = carouselGap(useLook())
  useActions(
    {
      left: () => {
        if (n) onIndex((index - 1 + n) % n)
        return true
      },
      right: () => {
        if (n) onIndex((index + 1) % n)
        return true
      },
      up: () => true,
      down: () => true,
      confirm: () => {
        if (n) onOpen()
        return true
      },
      menu: () => {
        onMenu()
        return true
      },
      x: () => {
        if (sys?.es || (sys && groupArtId(sys))) setOpts(true)
        return true
      },
      y: () => {
        if (sys && pin?.can(sys)) pin.toggle(sys)
        return true
      },
      back: () => {
        onBack?.()
        return true
      }
    },
    {
      enabled: active && !opts,
      hints: n
        ? [
            { action: 'left', label: onBack ? 'Podgrupa' : 'Grupa' },
            { action: 'confirm', label: 'Wybierz' },
            ...(sys?.es ? [{ action: 'x' as const, label: 'Opcje systemu' }] : sys && groupArtId(sys) ? [{ action: 'x' as const, label: 'Grafika grupy' }] : []),
            ...(sys && pin?.can(sys) ? [{ action: 'y' as const, label: pin.pinned(sys) ? 'Odepnij' : 'Przypnij' }] : []),
            ...(onBack ? [{ action: 'back' as const, label: 'Wstecz' }] : []),
            { action: 'menu', label: 'Menu' }
          ]
        : [{ action: 'menu', label: 'Menu' }]
    }
  )

  if (!n)
    return (
      <section className="tv-screen">
        <div className="tv-empty">
          <h2>Brak gier w bibliotece</h2>
          <p>Zaloguj to urządzenie do serwera EmuStart albo uruchom Steam — Start → Ustawienia.</p>
        </div>
      </section>
    )

  const facts = d ? [d.manufacturer, d.release ? (d.end ? `${d.release}–${d.end}` : `premiera ${d.release}`) : '', d.media, d.controllers ? `pady: ${d.controllers}` : ''].filter(Boolean) : []
  return (
    <section className="tv-screen tv-systems">
      <ConsoleBackdrop sys={sys} photos={consoleBackdrop} />
      <div className="tv-carousel">
        {systems.map((s, i) => {
          let dd = i - index
          if (dd > n / 2) dd -= n // the carousel is a loop
          if (dd < -n / 2) dd += n
          if (Math.abs(dd) > 3) return null
          return (
            <div key={s.key} onClick={() => (i === index ? onOpen() : onIndex(i))}>
              <SysCard sys={s} d={dd} gap={gap} plate={logoPlate} />
            </div>
          )
        })}
      </div>
      {opts && sys?.es && <SystemOptions es={sys.es} onClose={() => setOpts(false)} />}
      {opts && sys && !sys.es && <GroupArtOptions sys={sys} onClose={() => setOpts(false)} />}
      <div className="tv-sysinfo">
        {title && <p className="tv-syspath">{title}</p>}
        <h1>{sys.display}</h1>
        <p>{systemMeta(sys)}</p>
        {(facts.length > 0 || d?.description) && (
          <div className="tv-sysabout">
            {facts.length > 0 && (
              <p className="tv-sysfacts">
                {facts.map((f, i) => (i === 0 && d?.manufacturer ? <b key={i}>{f}</b> : <span key={i}>{(i ? '  ·  ' : '') + f}</span>))}
              </p>
            )}
            {d?.description && <p className="tv-sysdesc">{d.description}</p>}
          </div>
        )}
      </div>
      {consoleBackdrop && sys.console?.credit && <p className="tv-concredit">Zdjęcie konsoli: {sys.console.credit}</p>}
    </section>
  )
}
