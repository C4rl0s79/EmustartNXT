import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Game, LibrarySnapshot } from '@shared/types'

// the main window's handler for a game double-clicked on the Deck (lib/deckPlay.ts), with Lumen's API stubbed
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined })
const calls: string[] = []
const lumen = {
  game: { play: vi.fn(async (id: string) => (calls.push(`play ${id}`), { ok: true, message: 'Uruchamianie przez Steam…' })) },
  deck: { reveal: vi.fn(() => calls.push('reveal')) },
  emustart: { readiness: vi.fn(async () => null) },
  ui: { select: vi.fn() }
}
vi.stubGlobal('window', { lumen })
const { useStore } = await import('../src/renderer/src/store')
const { playFromDeck } = await import('../src/renderer/src/lib/deckPlay')

const steamGame = (installState: Game['installState']): Game =>
  ({ id: 'steam:1', source: 'steam', appId: 1, name: 'Gra', sortName: 'gra', provenance: [], installState, installed: installState === 'installed' }) as Game
const snapshot = (games: Game[]): LibrarySnapshot => ({ games, steam: { status: 'running' }, emustart: undefined }) as unknown as LibrarySnapshot

beforeEach(() => {
  calls.length = 0
  useStore.setState({ dialog: null, profiles: null, gogInstall: null, detailsId: null, toasts: [] })
})

describe('playFromDeck', () => {
  it('starts a game that can start as "Graj" does — the hidden main window stays hidden', async () => {
    useStore.setState({ snapshot: snapshot([steamGame('installed')]) })
    await playFromDeck('steam:1')
    expect(calls).toEqual(['play steam:1'])
  })

  it('a game that cannot start: its details and the main window (the reason is shown there)', async () => {
    useStore.setState({ snapshot: snapshot([steamGame('uninstalling')]) })
    await playFromDeck('steam:1')
    expect(calls).toEqual(['reveal'])
    expect(useStore.getState().detailsId).toBe('steam:1')
  })

  it('a question during the start (a dialog opens): the main window is shown, once', async () => {
    useStore.setState({ snapshot: snapshot([steamGame('installed')]) })
    lumen.game.play.mockImplementationOnce(async (id: string) => {
      calls.push(`play ${id}`)
      useStore.setState({ profiles: 'normal' })
      useStore.setState({ profiles: 'startup' })
      return { ok: true, message: '' }
    })
    await playFromDeck('steam:1')
    expect(calls).toEqual(['play steam:1', 'reveal'])
  })

  it('a main action that is not a start (Steam downloads) is never run: details and the window instead', async () => {
    useStore.setState({ snapshot: snapshot([steamGame('updating')]) })
    await playFromDeck('steam:1')
    expect(calls).toEqual(['reveal'])
    expect(useStore.getState().detailsId).toBe('steam:1')
  })

  it('a start that fails (an error toast): the window shows the error', async () => {
    useStore.setState({ snapshot: snapshot([steamGame('installed')]) })
    lumen.game.play.mockImplementationOnce(async (id: string) => (calls.push(`play ${id}`), { ok: false, error: 'Steam odmówił' }) as never)
    await playFromDeck('steam:1')
    expect(calls).toEqual(['play steam:1', 'reveal'])
  })

  it('a second double click while the game is starting does not start it twice', async () => {
    useStore.setState({ snapshot: snapshot([steamGame('installed')]) })
    await Promise.all([playFromDeck('steam:1'), playFromDeck('steam:1')])
    expect(calls).toEqual(['play steam:1'])
  })

  it('a game that is not in the library does nothing', async () => {
    useStore.setState({ snapshot: snapshot([]) })
    await playFromDeck('steam:9')
    expect(calls).toEqual([])
  })
})
