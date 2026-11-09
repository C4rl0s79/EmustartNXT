import { JobsStrip } from '../components/Jobs'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { api, attempt, useStore } from '../store'
import { useActions, useHints, type Action } from '../nav/input'
import { focusFirst } from '../nav/engine'
import { SettingsScreen } from '../screens/Settings'
import { TvSystems } from './TvSystems'
import { TvGames } from './TvGames'
import { subItem, useTvNav, type TvSystem } from './data'
import { lastSub, pinnable, rememberSub, togglePin } from '../lib/nav'
import { loginFlow, logoutFlow } from '../lib/account'
import { lookStyle, setLook, useEngineLook, useLook } from './look'
import { TvLook, useLookSync } from './TvLook'
import { TvThemes } from './TvThemes'
import { DEFAULT_THEME, lookDefaults, lookSpecFor, themeById, themeStyle } from './themes'
import '@fontsource-variable/cinzel'
import '@fontsource-variable/alegreya'
import '@fontsource-variable/oxanium'
import '@fontsource-variable/exo-2'
import '@fontsource-variable/atkinson-hyperlegible-next'
import './theme-css/fantasy.css'
import './theme-css/sf.css'
import { Icon } from '../components/Icon'
import './tv.css'

// The TV layout of Lumen's one interface (fullscreen mode) with EmuStart's look: group carousel (pinned
// subgroups, PC, Komputery, Konsole, Arcade…) → subgroup carousel (Wszystkie, Steam, GOG / platforms) →
// game list → play. The same library hierarchy, actions and overlays (launch, save conflict, profile lock,
// details) as the desktop layout — only the layout differs (docs/PLAN-TV-REACT.md).

type Screen = 'top' | 'subs' | 'games' | 'settings'

export function TvApp() {
  const { top, nav } = useTvNav()
  const emuSystems = useStore((s) => s.snapshot?.emustart?.systems)
  const pins = useStore((s) => s.prefs?.pinnedGroups ?? [])
  const [screen, setScreen] = useState<Screen>('top')
  const [topIdx, setTopIdx] = useState(0)
  const [subIdx, setSubIdx] = useState<Record<string, number>>({})
  // the game list was opened from the first level (pinned subgroup, single-subgroup group) or from subgroups
  const [from, setFrom] = useState<'top' | 'subs'>('top')
  const [menu, setMenu] = useState(false)
  const [lookEd, setLookEd] = useState(false)
  const [themesOpen, setThemesOpen] = useState(false)
  // the theme in use (Lumen's setting) or, while the chooser is open, the one being looked at
  const savedTheme = useStore((s) => s.settings?.tvTheme)
  const [previewTheme, setPreviewTheme] = useState<string | null>(null)
  const theme = themeById(previewTheme ?? savedTheme)
  // each theme has its own look: the EmuStart theme EmuStart's stored one (+ Lumen's own keys),
  // the others theirs from Lumen's settings — picked whenever the theme changes (the editor, while
  // open, owns the values)
  const engineLook = useEngineLook()
  const themeLooks = useStore((s) => s.settings?.tvLooks)
  useEffect(() => {
    if (lookEd) return
    const own = themeLooks?.[theme.id] ?? {}
    setLook(theme.id === DEFAULT_THEME ? { ...engineLook, ...own } : own)
  }, [theme.id, engineLook, themeLooks, lookEd])
  const selection = useStore((s) => s.detailsId)
  useLookSync()
  const look = useLook()

  const topItem = top[topIdx] as TvSystem | undefined
  const group = topItem && !topItem.sub ? nav.find((g) => g.id === topItem.group?.id) : undefined
  const subs = useMemo(() => (group ? group.subs.map((s) => subItem(group, s, emuSystems ?? [])) : []), [group, emuSystems])
  const gi = group ? Math.min(subs.length - 1, subIdx[group.id] ?? Math.max(0, group.subs.findIndex((s) => s.id === lastSub(group).id))) : 0
  const setSub = (i: number): void => {
    if (!group) return
    setSubIdx((m) => ({ ...m, [group.id]: i }))
    if (subs[i]?.sub) rememberSub(group.id, subs[i].sub!.id)
  }
  const sys = screen === 'games' ? (from === 'subs' ? subs[gi] : group?.subs.length === 1 ? subs[0] : topItem) : topItem
  const openTop = (): void => {
    if (!topItem) return
    if (topItem.sub || (group && group.subs.length === 1)) {
      setFrom('top')
      setScreen('games')
    } else setScreen('subs')
  }
  const pin = {
    can: (s: TvSystem) => !!s.sub && pinnable(s.sub),
    pinned: (s: TvSystem) => !!s.sub && pins.includes(s.sub.id),
    toggle: (s: TvSystem) => s.sub && void togglePin(s.sub.id, !pins.includes(s.sub.id))
  }

  // opened from the desktop with a game selected: start in its group, on its platform
  const opened = useStore((s) => s.uiSelection)
  useEffect(() => {
    if (!opened) return
    const ti = top.findIndex((t) => !t.sub && t.group?.games.some((g) => g.id === opened) && !['fav', 'recent', 'col'].includes(t.group.id))
    if (ti < 0) return
    setTopIdx(ti)
    const g = top[ti].group!
    const si = g.subs.findIndex((s, i) => i > 0 && s.games.some((x) => x.id === opened))
    if (si > 0) setSubIdx((m) => ({ ...m, [g.id]: si }))
    if (g.subs.length > 1) setScreen('subs')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened])
  useEffect(() => {
    if (topIdx >= top.length && top.length) setTopIdx(0)
  }, [top.length, topIdx])
  // the group shown on the second level vanished (its last game removed): back to the first level
  useEffect(() => {
    if (screen === 'subs' && !group) setScreen('top')
  }, [screen, group])
  return (
    <div className="tv" data-theme={theme.id} data-layer inert={selection ? true : undefined} style={{ ...lookStyle(look, lookDefaults(theme)), ...themeStyle(theme) } as CSSProperties}>
      {theme.ambient && <div className={`tv-ambient tv-ambient--${theme.ambient}`} aria-hidden="true" />}
      <TvTopBar />
      {screen === 'top' && (
        <TvSystems
          systems={top}
          index={topIdx}
          onIndex={setTopIdx}
          onOpen={openTop}
          onMenu={() => setMenu(true)}
          active={!menu && !lookEd && !themesOpen}
          logoPlate={!!theme.logoPlate}
          consoleBackdrop={!!theme.consoleBackdrop}
          pin={pin}
        />
      )}
      {screen === 'subs' && group && (
        <TvSystems
          key={group.id}
          systems={subs}
          index={gi}
          onIndex={setSub}
          onOpen={() => {
            setFrom('subs')
            setScreen('games')
          }}
          onBack={() => setScreen('top')}
          onMenu={() => setMenu(true)}
          active={!menu && !lookEd && !themesOpen}
          logoPlate={!!theme.logoPlate}
          consoleBackdrop={!!theme.consoleBackdrop}
          pin={pin}
          title={group.label}
        />
      )}
      {screen === 'games' && sys && (
        <TvGames
          key={sys.key}
          system={sys}
          onBack={() => setScreen(from === 'subs' && group ? 'subs' : 'top')}
          onMenu={() => setMenu(true)}
          active={!menu && !lookEd && !themesOpen}
          theme={theme}
        />
      )}
      {screen === 'settings' && <TvSettings onBack={() => setScreen('top')} />}
      {menu && (
        <TvMenu
          themeName={theme.name}
          onTheme={() => {
            setMenu(false)
            if (screen === 'settings') setScreen('top') // the chooser shows each theme on the layout underneath
            setThemesOpen(true)
          }}
          onClose={() => setMenu(false)}
          onSettings={() => {
            setMenu(false)
            setScreen('settings')
          }}
          onLook={() => {
            setMenu(false)
            if (screen === 'settings') setScreen('top') // the editor shows its changes on the layout underneath
            setLookEd(true)
          }}
        />
      )}
      {themesOpen && (
        <TvThemes
          current={themeById(savedTheme).id}
          onPreview={setPreviewTheme}
          onDone={(id) => {
            setThemesOpen(false)
            setPreviewTheme(null)
            if (id && id !== savedTheme)
              void attempt(api().settings.patch({ tvTheme: id })).then((s) => {
                if (!s) return
                useStore.getState().setSettings(s)
                useStore.getState().toast(`Motyw: ${themeById(id).name}`, 'info')
              })
          }}
        />
      )}
      {lookEd && (
        <TvLook
          spec={lookSpecFor(theme)}
          theme={theme}
          onClose={() => setLookEd(false)}
          previewLabel={screen === 'games' ? 'systemy' : 'gry'}
          onPreview={() => setScreen((s) => (s === 'games' || !sys ? 'top' : 'games'))}
        />
      )}
      <TvHints />
    </div>
  )
}

function TvTopBar() {
  const emu = useStore((s) => s.snapshot?.emustart)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(t)
  }, [])
  const server = emu?.server
  const net = !server
    ? { cls: 'warn', text: 'Serwer: nie zalogowano' }
    : server.ok
      ? { cls: 'ok', text: `Serwer ${server.name ?? ''}`.trim() }
      : server.key_rejected
        ? { cls: 'err', text: 'Serwer nie przyjmuje urządzenia' }
        : { cls: 'warn', text: 'Serwer: łączę…' }
  return (
    <header className="tv-top">
      <div className="tv-brand">
        Lu<b>men</b>
      </div>
      <JobsStrip />
      <div className="tv-status">
        {emu?.profile && (
          <span className="tv-pill">
            <Icon name="user" /> {emu.profile}
          </span>
        )}
        {emu?.engine === 'ready' && <span className={`tv-pill ${net.cls}`}>{net.text}</span>}
        <span className="tv-clock">{now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    </header>
  )
}

const PAD: Partial<Record<Action, [string, string]>> = {
  confirm: ['A', 'a'],
  back: ['B', 'b'],
  x: ['X', 'x'],
  y: ['Y', 'y'],
  lb: ['LB', 'sq'],
  rb: ['RB', 'sq'],
  lt: ['LT', 'sq'],
  rt: ['RT', 'sq'],
  menu: ['Start', 'sq'],
  view: ['View', 'sq'],
  ls: ['L3', 'sq'],
  rs: ['R3', 'sq'],
  left: ['↔', 'sq'],
  up: ['↕', 'sq']
}
const KEYS: Partial<Record<Action, string>> = {
  confirm: 'Enter',
  back: 'Esc',
  x: 'F',
  y: 'S',
  lb: 'Q',
  rb: 'E',
  lt: 'PgUp',
  rt: 'PgDn',
  menu: 'O',
  view: 'V',
  ls: 'Z',
  rs: 'U',
  left: '←→',
  up: '↑↓'
}

/** Button hints in EmuStart's style (coloured A/B/X/Y), from the active input layer. */
function TvHints() {
  const hints = useHints()
  const mode = useStore((s) => s.inputMode)
  if (mode === 'mouse') return <footer className="tv-hints" />
  return (
    <footer className="tv-hints" aria-hidden="true">
      {hints.map((h) => {
        const [label, cls] = PAD[h.action] ?? [h.action, 'sq']
        return (
          <span key={h.action + h.label} className="tv-hint">
            {mode === 'gamepad' ? <span className={`tv-btn tv-btn--${cls}`}>{label}</span> : <span className="tv-btn tv-btn--sq">{KEYS[h.action] ?? label}</span>}
            {h.label}
          </span>
        )
      })}
    </footer>
  )
}

function TvMenu({
  onClose,
  onSettings,
  onLook,
  onTheme,
  themeName
}: {
  onClose: () => void
  onSettings: () => void
  onLook: () => void
  onTheme: () => void
  themeName: string
}) {
  const loggedIn = useStore((s) => !!s.snapshot?.emustart?.server)
  const items: [string, () => void][] = [
    ['Ustawienia', onSettings],
    [`Motyw: ${themeName}`, onTheme],
    ['Wygląd', onLook],
    [
      'Zmień profil',
      () => {
        onClose()
        useStore.getState().setProfiles('normal')
      }
    ],
    [
      'Kolejność padów',
      () => {
        onClose()
        useStore.getState().setPads(true)
      }
    ],
    [
      'Kontrolery',
      () => {
        onClose()
        useStore.getState().setControllers(true)
      }
    ],
    [
      loggedIn ? 'Wyloguj z serwera' : 'Zaloguj do serwera',
      () => {
        onClose()
        void (loggedIn ? logoutFlow() : loginFlow())
      }
    ],
    [
      'Tryb pulpitu  ·  F10 / View+Start',
      () => {
        onClose()
        void api().ui.setMode('desktop')
      }
    ],
    [
      'Odśwież bibliotekę z serwera',
      () => {
        onClose()
        void attempt(api().emustart.refreshLibrary()).then((r) => r && useStore.getState().toast(r.ok ? (r.message ?? 'Odświeżanie biblioteki…') : (r.error ?? 'Błąd'), r.ok ? 'info' : 'error'))
      }
    ],
    [
      'Sprawdź aktualizację Lumen',
      () => {
        onClose()
        void attempt(api().update.check()).then((u) => {
          if (!u) return
          const t = useStore.getState().toast
          if (u.phase === 'available' || u.phase === 'ready') t(`Dostępna wersja ${u.info?.version ?? ''} — Ustawienia → Aktualizacja Lumen.`, 'info')
          else if (u.phase === 'none') t('Lumen jest aktualny.', 'info')
          else if (u.phase === 'error') t(u.error ?? 'Nie udało się sprawdzić aktualizacji.', 'error')
        })
      }
    ],
    [
      'Zadania',
      () => {
        onClose()
        useStore.getState().setJobsOpen(true)
      }
    ],
    ['Wyjdź z Lumen', () => void api().app.quit()]
  ]
  const [idx, setIdx] = useState(0)
  useActions(
    {
      up: () => {
        setIdx((i) => (i - 1 + items.length) % items.length)
        return true
      },
      down: () => {
        setIdx((i) => (i + 1) % items.length)
        return true
      },
      left: () => true,
      right: () => true,
      confirm: () => {
        items[idx][1]()
        return true
      },
      back: () => {
        onClose()
        return true
      },
      menu: () => {
        onClose()
        return true
      }
    },
    {
      modal: true,
      hints: [
        { action: 'confirm', label: 'Wybierz' },
        { action: 'back', label: 'Zamknij' }
      ]
    }
  )
  return (
    <div className="tv-modal">
      <div className="tv-panel">
        <h2>Menu</h2>
        <ul className="tv-menulist">
          {items.map(([label, run], i) => (
            <li key={label} className={i === idx ? 'sel' : ''} onMouseEnter={() => setIdx(i)} onClick={run}>
              {label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/** Lumen's settings (the same screen as on the desktop) inside the TV frame; B returns. */
function TvSettings({ onBack }: { onBack: () => void }) {
  useActions(
    {
      back: () => {
        // inside a section B goes back to the list of sections (the settings screen handles it)
        if (document.activeElement?.closest('.settings__pane')) return false
        onBack()
        return true
      }
    },
    { hints: [{ action: 'back', label: 'Wróć' }] }
  )
  useEffect(() => {
    const t = setTimeout(() => {
      const el = document.querySelector<HTMLElement>('.tv-settings')
      if (el) focusFirst(el)
    }, 50)
    return () => clearTimeout(t)
  }, [])
  return (
    <section className="tv-screen tv-settings">
      <SettingsScreen active />
    </section>
  )
}
