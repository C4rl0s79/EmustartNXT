import { useEffect, useRef, useState } from 'react'
import { api, attempt, useStore } from '../store'
import { useActions } from '../nav/input'
import {
  choiceValue,
  getLook,
  isChoice,
  isSetting,
  lookFromEngine,
  lookOverrides,
  lookToSave,
  lookValue,
  rangeValue,
  setEngineLook,
  setLook,
  stepLook,
  useLook,
  type LookItem,
  type LookRow,
  type LookValues
} from './look'
import { DEFAULT_THEME, lookDefaults, type TvTheme } from './themes'

// The look editor of the TV layout (EmuStart's look.js in React): a side panel over the live layout,
// every change shows at once. The look belongs to the theme in use: the EmuStart theme saves to
// EmuStart's config ("look", with the profile unless kept for this computer), so standalone EmuStart
// shares it — only Lumen's own keys (typefaces) go to Lumen's settings; every other theme keeps its
// whole look in Lumen's settings (Settings.tvLooks), on top of the theme's own defaults.

type Settings = { gamesLogo: boolean; lookScope: 'profile' | 'machine' }
type EngineState = { look?: unknown; look_scope?: string; games_logo?: boolean }

/** Loads the stored look when the engine is ready and again after a profile change (look per profile). */
export function useLookSync(): void {
  const ready = useStore((s) => s.snapshot?.emustart?.engine === 'ready')
  const profile = useStore((s) => s.snapshot?.emustart?.profile)
  useEffect(() => {
    if (!ready) return
    let alive = true
    void api()
      .emustart.account('get_state')
      .then((r) => alive && setEngineLook(lookFromEngine((r as EngineState | null)?.look)))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [ready, profile])
}

export function TvLook({
  onClose,
  onPreview,
  previewLabel,
  spec,
  theme
}: {
  onClose: () => void
  onPreview: () => void
  previewLabel: string
  /** the editor's rows: the whole look, without what the TV theme decides itself (themes.ts) */
  spec: LookRow[]
  /** the theme whose look this is (its defaults, and where the look is saved) */
  theme: TvTheme
}) {
  const values = useLook()
  const defaults = lookDefaults(theme)
  // what is shown: the player's values over the theme's defaults
  const eff: LookValues = { ...defaults, ...values }
  const [idx, setIdx] = useState(() => Math.max(0, spec.findIndex((r) => 'k' in r)))
  const [left, setLeft] = useState(false)
  const [settings, setSettings] = useState<Settings | null>(null)
  const saved = useRef(JSON.stringify(getLook()))
  const armed = useRef(0)
  const listRef = useRef<HTMLDivElement>(null)
  const toast = useStore((s) => s.toast)

  useEffect(() => {
    void api()
      .emustart.account('get_state')
      .then((r) => {
        const st = r as EngineState | null
        setSettings({ gamesLogo: !!st?.games_logo, lookScope: st?.look_scope === 'machine' ? 'machine' : 'profile' })
      })
      .catch(() => undefined)
  }, [])
  useEffect(() => {
    listRef.current?.querySelector('.tv-lkrow.sel')?.scrollIntoView({ block: 'nearest' })
  }, [idx])

  const item = (): LookItem | undefined => {
    const r = spec[idx]
    return r && 'k' in r ? r : undefined
  }
  const move = (dir: number): void => {
    let i = idx
    do i = (i + dir + spec.length) % spec.length
    while (!('k' in spec[i]))
    setIdx(i)
  }
  const step = (it: LookItem | undefined, dir: number, times = 1): void => {
    if (!it) return
    if (isSetting(it)) {
      if (!settings) return
      const patch: Partial<Settings> = it.setting === 'gamesLogo' ? { gamesLogo: !settings.gamesLogo } : { lookScope: settings.lookScope === 'profile' ? 'machine' : 'profile' }
      setSettings({ ...settings, ...patch })
      void attempt(api().emustart.setOptions(patch))
      return
    }
    let v: LookValues = { ...defaults, ...getLook() }
    for (let i = 0; i < (isChoice(it) ? 1 : times); i++) v = stepLook(v, it, dir)
    // keep only what differs from the theme's defaults (the rest follows the theme)
    setLook(lookOverrides(v, defaults))
  }
  const reset = (it: LookItem | undefined): void => {
    if (!it || isSetting(it)) return
    const v = { ...getLook() }
    delete v[it.k]
    setLook(v)
  }
  const close = async (): Promise<void> => {
    const data = getLook()
    if (JSON.stringify(data) === saved.current) return onClose()
    const st = useStore.getState()
    const looks = st.settings?.tvLooks ?? {}
    const emu = theme.id === DEFAULT_THEME
    const own = lookOverrides(data, defaults, emu)
    // the stores first, so the layout keeps showing the new look when the editor closes
    if (emu) setEngineLook(lookToSave(data))
    if (st.settings) st.setSettings({ ...st.settings, tvLooks: { ...looks, [theme.id]: own } })
    onClose()
    let ok = !!(await attempt(api().settings.patch({ tvLooks: { ...looks, [theme.id]: own } })))
    if (emu) {
      const engineData = lookToSave(data)
      if (JSON.stringify(engineData) !== JSON.stringify(lookToSave(JSON.parse(saved.current) as LookValues))) {
        const r = await attempt(api().emustart.account('look_save', engineData))
        ok = ok && !!(r as { ok?: boolean } | null)?.ok
      }
    }
    toast(ok ? `Zapisano wygląd motywu ${theme.name}.` : 'Nie udało się zapisać wyglądu.', ok ? 'info' : 'error')
  }

  useActions(
    {
      up: () => (move(-1), true),
      down: () => (move(1), true),
      left: () => (step(item(), -1), true),
      right: () => (step(item(), 1), true),
      lb: () => (step(item(), -1, 5), true),
      rb: () => (step(item(), 1, 5), true),
      x: () => (reset(item()), true),
      y: () => (setLeft((l) => !l), true),
      confirm: () => (onPreview(), true),
      menu: () => {
        if (performance.now() - armed.current > 2500) {
          armed.current = performance.now()
          toast('Wciśnij Start jeszcze raz, żeby przywrócić wszystko.')
          return true
        }
        armed.current = 0
        setLook({})
        toast(`Przywrócono wygląd motywu ${theme.name}.`)
        return true
      },
      back: () => (void close(), true),
      view: () => true
    },
    {
      modal: true,
      hints: [
        { action: 'left', label: 'Zmień' },
        { action: 'lb', label: '×5' },
        { action: 'confirm', label: `Podgląd: ${previewLabel}` },
        { action: 'y', label: 'Przesuń okno' },
        { action: 'x', label: 'Domyślna' },
        { action: 'menu', label: 'Wszystko domyślne' },
        { action: 'back', label: 'Zapisz' }
      ]
    }
  )

  return (
    <div className={`tv-look ${left ? 'left' : ''}`}>
      <h2>Wygląd: {theme.name}</h2>
      <div className="tv-look__list" ref={listRef}>
        {spec.map((r, i) => {
          if (!('k' in r))
            return (
              <div key={r.head} className="tv-lkrow head">
                {r.head}
              </div>
            )
          const sel = i === idx
          const pick = (dir: number) => (e: React.MouseEvent) => {
            e.stopPropagation()
            setIdx(i)
            step(r, dir)
          }
          let val: React.ReactNode
          let chg = false
          if (isSetting(r)) {
            const text = !settings ? '…' : r.setting === 'gamesLogo' ? (settings.gamesLogo ? 'tak' : 'nie') : settings.lookScope === 'machine' ? 'dla tego komputera' : 'dla profilu (na każdym komputerze)'
            val = (
              <>
                <span className="ch" onClick={pick(-1)}>
                  ◀
                </span>
                <b>{text}</b>
                <span className="ch" onClick={pick(1)}>
                  ▶
                </span>
              </>
            )
          } else if (isChoice(r)) {
            const v = choiceValue(eff, r)
            chg = v !== lookValue(defaults, r)
            val = (
              <>
                <span className="ch" onClick={pick(-1)}>
                  ◀
                </span>
                {r.swatch && <span className="sw" style={{ background: v }} />}
                <b>{r.fmt(v)}</b>
                <span className="ch" onClick={pick(1)}>
                  ▶
                </span>
              </>
            )
          } else {
            const v = rangeValue(eff, r)
            chg = v !== r.def
            val = (
              <>
                <span className="ch" onClick={pick(-1)}>
                  −
                </span>
                <span className="track">
                  <i style={{ width: `${((100 * (v - r.min)) / (r.max - r.min)).toFixed(1)}%` }} />
                </span>
                <span className="ch" onClick={pick(1)}>
                  +
                </span>
                <b>{r.fmt(v)}</b>
              </>
            )
          }
          return (
            <div
              key={r.k}
              className={`tv-lkrow ${sel ? 'sel' : ''} ${chg ? 'chg' : ''}`}
              onClick={() => setIdx(i)}
              onWheel={(e) => {
                setIdx(i)
                step(r, e.deltaY < 0 ? 1 : -1)
              }}
            >
              <span className="lk">{r.t}</span>
              <span className="lv">{val}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
