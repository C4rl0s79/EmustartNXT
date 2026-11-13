import { useState } from 'react'
import type { ActionResult, Game } from '@shared/types'
import { FAMILY_LABEL } from '@shared/libraryNav'
import { api, askChoice, attempt, useStore } from '../store'
import { GogSaves, launchGog } from './GogSaves'
import { GogExtras } from './GogExtras'
import { formatBytes } from '../lib/format'
import { langName } from './GogInstall'

// GOG game details (both layouts: the details screen is shared): facts and actions. Every action runs in the
// EmuStart engine; Lumen only asks for it (src/main/gog/ipc.ts).

const STATE_TEXT: Record<string, string> = {
  notInstalled: 'nie zainstalowana',
  installing: 'instalowanie',
  installed: 'zainstalowana',
  needs_admin: 'czeka na krok administratora',
  failed: 'instalacja nieukończona',
  cancelled: 'instalacja przerwana',
  damaged: 'pliki niezgodne z manifestem'
}

export function gogFacts(game: Game, server?: string): [string, string | undefined][] {
  const g = game.gog
  if (!g) return []
  const dlcName = (id: string): string => g.available?.dlcs.find((d) => d.id === id)?.name ?? id
  return [
    ['Źródło', `GOG z archiwum serwera EmuStart${server ? ` (${server})` : ''}`],
    ['Stan', STATE_TEXT[g.state] ?? g.state],
    ['Wersja', g.version || g.buildId || g.available?.version],
    ['Rozmiar', formatBytes(g.available?.size ?? 0)],
    ['Języki', g.languages?.length ? g.languages.map(langName).join(', ') + (g.primary && g.languages.length > 1 ? ` (główny: ${langName(g.primary)})` : '') : undefined],
    ['Języki na serwerze', !g.languages?.length && g.available ? g.available.languages.map(langName).join(', ') : undefined],
    ['DLC', g.dlcs?.length ? g.dlcs.map(dlcName).join(', ') : undefined],
    ['Folder', g.installDir],
    ['Biblioteki systemowe', g.runtimes?.length ? g.runtimes.map((r) => `${r.id}${r.done ? ' ✓' : ''}`).join(', ') : undefined],
    ['Pominięte kroki instalatora', g.skipped?.length ? g.skipped.join('; ') : undefined],
    ['Nieudane kroki administratora', g.adminFailed ? `${g.adminFailed} (pominięte po 3 próbach — gra może nie działać poprawnie)` : undefined],
    ['Uwaga', g.updateNote],
    ['Błąd', g.state !== 'installed' ? g.error : undefined]
  ]
}

function report(r: ActionResult | undefined): void {
  if (r) useStore.getState().toast(r.ok ? (r.message ?? 'Gotowe') : r.error, r.ok ? 'info' : 'error')
}

/** „Uruchom…”: zadanie gry z goggame-*.info (np. „Graphic Mode Setup” — GOGDOSConfig dostaje numer gry, bez niego
 *  pokazuje błąd) — to samo okno na pulpicie (Szczegóły) i w trybie TV (Opcje gry). */
export async function chooseGogTask(game: Game, before?: () => void): Promise<void> {
  const tasks = await attempt(api().gog.playTasks(game.id))
  if (!tasks?.length) return void useStore.getState().toast('Ta gra nie ma zadań uruchamiania.', 'info')
  const i = await askChoice('Uruchom', tasks.map((t) => `${t.name}${t.default ? ' (domyślnie)' : ''}${t.category === 'launcher' ? ' — launcher' : ''}`))
  if (i === null) return
  before?.()
  report(await launchGog(game.id, tasks[i].index))
}

/** Usunięcie gry GOG z tego komputera — z wyborem plików skopiowanych przez instalator poza folder gry (Dokumenty,
 *  AppData — np. domyślne ustawienia); to samo okno na pulpicie (Szczegóły) i w trybie TV (Opcje gry). */
export async function uninstallGog(game: Game): Promise<void> {
  const outside = (await attempt(api().gog.uninstallPreview(game.id)))?.outside ?? []
  if (!outside.length) {
    const i = await askChoice(`Usunąć ${game.name} z tego komputera?`, [
      'Usuń pliki gry (zapisy i pliki dodane przez grę zostają; archiwum na serwerze bez zmian)',
      'Anuluj'
    ])
    if (i === 0) report(await attempt(api().gog.uninstall(game.id)))
    return
  }
  const names = outside.slice(0, 3).map((p) => p.split(/[\\/]/).slice(-2).join('\\')).join(', ') + (outside.length > 3 ? ', …' : '')
  const i = await askChoice(`Usunąć ${game.name} z tego komputera? Instalator skopiował też ${outside.length} plik(ów) poza folder gry: ${names}`, [
    `Usuń grę, zostaw pliki w Dokumentach / AppData (${outside.length})`,
    `Usuń grę i pliki w Dokumentach / AppData (${outside.length}) — zapisy zostają`,
    'Anuluj'
  ])
  if (i === 0 || i === 1) report(await attempt(api().gog.uninstall(game.id, i === 1)))
}

/** gra GOG ma pliki na tym komputerze (także nieukończona instalacja) — można ją usunąć */
export const gogRemovable = (g: Game['gog']): boolean => !!g && ['installed', 'needs_admin', 'damaged', 'failed', 'cancelled'].includes(g.state)

export function GogActions({ game }: { game: Game }) {
  const g = game.gog!
  const engineOk = useStore((s) => s.snapshot?.emustart?.engine === 'ready')
  const serverOk = useStore((s) => !!s.snapshot?.emustart?.server?.ok)
  const [saves, setSaves] = useState(false)
  const [extras, setExtras] = useState(false)
  if (!engineOk) return null
  const installed = g.state === 'installed' || g.state === 'needs_admin' || g.state === 'damaged'
  const moreDlc = (g.available?.dlcs ?? []).some((d) => !(g.dlcs ?? []).includes(d.id))

  const chooseTask = (): Promise<void> => chooseGogTask(game)
  const verify = async (): Promise<void> => {
    useStore.getState().toast('Sprawdzam pliki gry (MD5 z manifestu)…', 'info')
    const r = await attempt(api().gog.verify(game.id))
    if (!r) return
    if (r.error) return useStore.getState().toast(r.error, 'error')
    useStore.getState().toast(r.ok ? `Pliki zgodne z manifestem (${r.checked}).` : `Niezgodnych plików: ${r.badCount} — „Napraw pliki” pobierze tylko je z serwera.`, r.ok ? 'info' : 'error')
  }
  const uninstall = (): Promise<void> => uninstallGog(game)

  return (
    <>
      {g.state === 'installed' && (
        <button className="btn" data-nav data-key="gog-task" onClick={() => void chooseTask()}>
          Uruchom…
        </button>
      )}
      {installed && (
        <button className="btn" data-nav data-key="gog-verify" onClick={() => void verify()}>
          Sprawdź pliki
        </button>
      )}
      {installed && (
        <button className="btn" data-nav data-key="gog-saves" title="Zapisy i ustawienia gry synchronizowane przez serwer EmuStart" onClick={() => setSaves(true)}>
          Zapisy…
        </button>
      )}
      {saves && <GogSaves game={game} onClose={() => setSaves(false)} />}
      {!!g.extras?.length && serverOk && (
        <button className="btn" data-nav data-key="gog-extras" title="Wybierz, które dodatki pobrać z serwera" onClick={() => setExtras(true)}>
          Dodatki ({g.extras.length})
        </button>
      )}
      {extras && <GogExtras game={game} onClose={() => setExtras(false)} />}
      {g.state === 'installed' && moreDlc && serverOk && (
        <button className="btn" data-nav data-key="gog-dlc" onClick={() => useStore.getState().setGogInstall({ gameId: game.id, dlcOnly: true })}>
          Dodaj DLC
        </button>
      )}
      {g.pendingDlc && serverOk && (
        <button className="btn" data-nav data-key="gog-dlc-resume" onClick={async () => report(await attempt(api().gog.resume(game.id)))}>
          Dokończ instalację DLC
        </button>
      )}
      {g.state === 'installed' && g.runtimes?.some((r) => !r.done) && (
        <button
          className="btn"
          data-nav
          data-key="gog-runtimes"
          title="Visual C++ / DirectX z zależności gry, których nie ma w Windows — jedno okno UAC (Lumen jako administrator: bez okna)"
          onClick={async () => report(await attempt(api().gog.installRuntimes(game.id)))}
        >
          Biblioteki systemowe
        </button>
      )}
      {(installed || g.state === 'failed' || g.state === 'cancelled') && (
        <button className="btn btn--danger" data-nav data-key="gog-remove" onClick={() => void uninstall()}>
          Usuń grę
        </button>
      )}
    </>
  )
}

/** A Steam shortcut's platform in the library (automatic from tags / the program, or chosen here). */
export function PlatformButton({ game }: { game: Game }) {
  const catalog = useStore((s) => s.snapshot?.platforms ?? [])
  const choose = async (): Promise<void> => {
    const list = [...catalog].sort((a, b) => a.family.localeCompare(b.family) || a.display.localeCompare(b.display, 'pl'))
    const items = ['Automatycznie (oznaczenia Steam / program)', 'PC — natywna gra', 'Pozostałe — nieznana platforma', ...list.map((p) => `${FAMILY_LABEL[p.family]} › ${p.display}`)]
    const i = await askChoice('Platforma w bibliotece', items)
    if (i === null) return
    const value = i === 0 ? null : i === 1 ? 'pc' : i === 2 ? 'other' : `emu:${list[i - 3].es}`
    const p = await attempt(api().prefs.setPlatformOverride(game.id, value))
    if (p) useStore.getState().setPrefs(p)
  }
  return (
    <button className="btn" data-nav data-key="platform" onClick={() => void choose()} title="Gdzie skrót pojawia się w bibliotece (PC, Konsole…)">
      Platforma{game.platform ? `: ${game.platform.label}` : ''}
    </button>
  )
}
