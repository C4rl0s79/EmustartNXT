import { api, useStore } from '../store'
import { primaryFor } from './primary'

// A game started from a Deck tile (double click). The Deck window only asks; the main window runs the game's
// one main action exactly as its "Graj" button does (lib/primary.ts: Steam, GOG, EmuStart with downloading,
// the emulator check, saves) — so a Deck launch behaves the same. The main window may be hidden (closed
// while Deck is on): it is shown only when the player has to answer something — the game cannot start (its
// details say why), a save conflict, who plays — and otherwise stays hidden (decision G4).

/** games being started from the Deck right now — a second double click does not start one twice */
const starting = new Set<string>()

export async function playFromDeck(gameId: string): Promise<void> {
  if (starting.has(gameId)) return
  starting.add(gameId)
  try {
    await play(gameId)
  } finally {
    starting.delete(gameId)
  }
}

async function play(gameId: string): Promise<void> {
  const st = useStore.getState()
  const game = st.snapshot?.games.find((g) => g.id === gameId)
  if (!game) return
  const installing = st.jobs.jobs.some((j) => j.kind === 'emuInstall')
  // what is missing before an EmuStart game can start — asked as the "Graj" button asks it (lib/primary.ts)
  const ready = game.emu && st.snapshot?.emustart?.engine === 'ready' && !installing ? await api().emustart.readiness(gameId).catch(() => null) : null
  const primary = primaryFor(game, { steamStatus: st.snapshot?.steam.status, emuSummary: st.snapshot?.emustart, ready, installing, setBusy: () => {} })
  if (!primary.play || primary.disabled || !primary.run) {
    // not a start (cannot start now, or the main action is something else — an install, a repair, Steam's
    // downloads): never run with nobody looking — its details explain, in the main window
    st.openDetails(gameId)
    if (primary.note) st.toast(primary.note, primary.disabled ? 'error' : 'info')
    api().deck.reveal()
    return
  }
  // a question during the start (a save conflict, who plays, an install window) or an error needs the window
  // (an error toast shown after this point — counted by id: older toasts fading away do not hide a new one)
  const since = st.toasts.reduce((m, t) => Math.max(m, t.id), 0)
  const needsWindow = (s: ReturnType<typeof useStore.getState>): boolean =>
    !!(s.dialog || s.profiles || s.gogInstall) || s.toasts.some((t) => t.kind === 'error' && t.id > since)
  let shown = false
  const reveal = (): void => {
    if (shown) return
    shown = true
    api().deck.reveal()
  }
  const off = useStore.subscribe((s) => needsWindow(s) && reveal())
  try {
    await primary.run()
  } finally {
    off()
  }
  if (needsWindow(useStore.getState())) reveal()
}
