import { BrowserWindow, Menu, screen } from 'electron'
import { dockRect, layoutFor, screenKey, type DeckSettings } from '@shared/deck'
import { DesktopLayerGuard, handleOf, makeUnobtrusive, pinAboveDesktop, taskbarCreatedMessage } from './desktopLayer'
import { log } from './logger'

// The Deck window — Lumen's optional desktop interface: a dock over the wallpaper and below every
// application window (desktopLayer.ts), never focused, outside Alt+Tab and the taskbar. It exists only
// while Deck is on in the settings; switched off, the window is destroyed and nothing of it keeps running.
// It lives on the primary screen (as PyLinksDeck did); its dimensions follow the screen (shared/deck.ts).

export interface DeckHost {
  preload: string
  /** loads the Deck page (renderer/deck.html) into the window */
  load(w: BrowserWindow): void
  deck(): DeckSettings
  /** "Otwórz Lumen" */
  openMain(): void
  /** "Wyłącz Decka" */
  disable(): void
  /** "Zamknij Lumen" */
  quit(): void
}

/** The screen Deck is on (the primary one, as PyLinksDeck) — the key its dimensions are stored under. */
export function deckScreen(): { key: string; label: string } {
  const d = screen.getPrimaryDisplay()
  return screenKey(d.size.width, d.size.height, d.scaleFactor)
}

/** a screen change may come without an event, or before Windows reports the new size — checked every 3 s too */
const SCREEN_CHECK_MS = 3000
const SCREEN_SETTLE_MS = 400

export class DeckWindow {
  private dock: BrowserWindow | null = null
  private guard: DesktopLayerGuard | null = null
  private screenTimer: NodeJS.Timeout | undefined
  private settleTimer: NodeJS.Timeout | undefined
  private screenState = ''
  private readonly onScreen = (): void => {
    clearTimeout(this.settleTimer)
    this.settleTimer = setTimeout(() => this.place(), SCREEN_SETTLE_MS)
  }

  constructor(private readonly host: DeckHost) {}

  /** the Deck window, when Deck is on */
  get window(): BrowserWindow | null {
    return this.dock && !this.dock.isDestroyed() ? this.dock : null
  }

  /** Follow the settings: create, place again or destroy the window. */
  sync(): void {
    const on = this.host.deck().enabled
    if (on && !this.window) this.open()
    else if (!on && this.window) this.close()
    else if (this.window) this.place()
  }

  private open(): void {
    const w = new BrowserWindow({
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      transparent: true,
      backgroundColor: '#00000000',
      title: 'Lumen Deck',
      webPreferences: { preload: this.host.preload, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: true }
    })
    this.dock = w
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    w.webContents.on('will-navigate', (e) => e.preventDefault())
    // a crashed page would leave a dead dock — with the main window hidden, the only way back to Lumen
    w.webContents.on('render-process-gone', (_e, d) => {
      log.error('deck', `renderer gone: ${d.reason} — reloading`)
      if (!w.isDestroyed()) this.host.load(w)
    })
    w.once('ready-to-show', () => {
      if (w.isDestroyed()) return
      this.place()
      w.showInactive()
      this.pin()
      log.info('deck', 'shown')
    })
    // closed some other way than close() (Windows, Explorer): stop what watches for it too
    w.on('closed', () => {
      if (this.dock === w) this.close()
    })
    try {
      // Explorer restarted (or crashed): Progman is created again, the window must be inserted again
      w.hookWindowMessage(taskbarCreatedMessage(), () => {
        log.info('deck', 'Explorer restarted — back above the desktop')
        this.pin()
      })
    } catch (e) {
      log.warn('deck', `TaskbarCreated: ${(e as Error).message}`)
    }
    this.guard = new DesktopLayerGuard(
      () => (this.window?.isVisible() ? [handleOf(this.window.getNativeWindowHandle())] : []),
      () => log.info('deck', 'the desktop was raised over the dock — inserted again'),
      3000,
      (e) => log.warn('deck', `desktop layer: ${e.message}`)
    )
    this.guard.start()
    screen.on('display-added', this.onScreen)
    screen.on('display-removed', this.onScreen)
    screen.on('display-metrics-changed', this.onScreen)
    this.screenTimer = setInterval(() => {
      if (this.state() !== this.screenState) this.place()
    }, SCREEN_CHECK_MS)
    this.host.load(w)
    log.info('deck', 'on')
  }

  /** Switch off: the window and everything watching for it are gone. */
  close(): void {
    this.guard?.stop()
    this.guard = null
    clearInterval(this.screenTimer)
    clearTimeout(this.settleTimer)
    screen.removeListener('display-added', this.onScreen)
    screen.removeListener('display-removed', this.onScreen)
    screen.removeListener('display-metrics-changed', this.onScreen)
    const w = this.window
    this.dock = null
    this.screenState = ''
    if (w) {
      w.destroy()
      log.info('deck', 'off')
    }
  }

  /** primary screen: size, scale and work area (a change means: place the dock again) */
  private state(): string {
    const d = screen.getPrimaryDisplay()
    const a = d.workArea
    return `${d.size.width}x${d.size.height}@${d.scaleFactor}|${a.x},${a.y},${a.width},${a.height}`
  }

  private place(): void {
    const w = this.window
    if (!w) return
    const d = screen.getPrimaryDisplay()
    const s = this.host.deck()
    const { key, label } = deckScreen()
    this.screenState = this.state()
    w.setBounds(dockRect(d.workArea, layoutFor(s, key, label)))
    w.setOpacity(s.opacity)
    this.pin()
  }

  private pin(): void {
    const w = this.window
    if (!w) return
    try {
      const h = handleOf(w.getNativeWindowHandle())
      makeUnobtrusive(h)
      pinAboveDesktop(h)
    } catch (e) {
      log.warn('deck', `desktop layer: ${(e as Error).message}`)
    }
  }

  /** The dock's own menu (right click). */
  popupMenu(): void {
    const w = this.window
    if (!w) return
    Menu.buildFromTemplate([
      { label: 'Otwórz Lumen', click: () => this.host.openMain() },
      { label: 'Wyłącz Decka', click: () => this.host.disable() },
      { type: 'separator' },
      { label: 'Zamknij Lumen', click: () => this.host.quit() }
    ]).popup({ window: w })
  }
}
