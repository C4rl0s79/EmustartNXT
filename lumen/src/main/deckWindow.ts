import { BrowserWindow, Menu, Tray, screen, type MenuItemConstructorOptions, type NativeImage } from 'electron'
import { deckGeometry, layoutFor, screenKey, type DeckGeometry, type DeckSettings } from '@shared/deck'
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
  /** the window is gone (closed from outside, its page keeps crashing) — Deck is still on in the settings */
  lost(): void
  /** "Wyłącz Decka" */
  disable(): void
  /** "Zamknij Lumen" */
  quit(): void
  /** where the dock and the games panel are inside the window (sent to the Deck page) */
  geometry(w: BrowserWindow, g: DeckGeometry): void
  /** Lumen's icon for the tray */
  icon(): Promise<NativeImage>
  /** Lumen starts with Windows (just the Deck, the main window hidden) — G5, an option in the menu */
  autostart(): boolean
  /** false when Windows refused it */
  setAutostart(on: boolean): boolean
  /** ustawienia Decka w jego menu (grupy, wymiary, wyświetlanie — jak w PyLinksDeck), budowane przy każdym otwarciu */
  settingsMenu(): MenuItemConstructorOptions[]
}

/** The screen Deck is on (the primary one, as PyLinksDeck) — the key its dimensions are stored under. */
export function deckScreen(): { key: string; label: string } {
  const d = screen.getPrimaryDisplay()
  // the label shows the screen's real resolution (device pixels), the key stays in logical ones
  // (dipToScreenRect: Windows and Linux only — Lumen is built for Windows)
  const px =
    process.platform === 'darwin'
      ? { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) }
      : screen.dipToScreenRect(null, d.bounds)
  return screenKey(d.size.width, d.size.height, d.scaleFactor, px)
}

/** a screen change may come without an event, or before Windows reports the new size — checked every 3 s too */
const SCREEN_CHECK_MS = 3000
const SCREEN_SETTLE_MS = 400
const MAX_RELOADS = 3

export class DeckWindow {
  private dock: BrowserWindow | null = null
  /**
   * Lumen's icon in the tray while Deck is on: with the main window hidden (closing it only hides it) it is
   * the way back that does not depend on the Deck window — a dock gone or broken left Lumen running with
   * nothing on screen (PyLinksDeck had one too)
   */
  private tray: Tray | null = null
  private guard: DesktopLayerGuard | null = null
  private screenTimer: NodeJS.Timeout | undefined
  private settleTimer: NodeJS.Timeout | undefined
  private screenState = ''
  /** the games panel is open: the height its tiles need (px); null — just the dock */
  private content: number | null = null
  /** the last geometry sent — asked for by the page when it (re)loads */
  private last: DeckGeometry | null = null

  get geometry(): DeckGeometry | null {
    return this.window ? this.last : null
  }
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
    // a crashed page would leave a dead dock — with the main window hidden, the only way back to Lumen;
    // reloaded a few times, then given up (a page that crashes on load would reload forever)
    let crashes = 0
    w.webContents.on('render-process-gone', (_e, d) => {
      crashes++
      log.error('deck', `renderer gone: ${d.reason}${crashes <= MAX_RELOADS ? ' — reloading' : ' — giving up'}`)
      if (w.isDestroyed()) return
      if (crashes <= MAX_RELOADS) this.host.load(w)
      else this.host.lost()
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
      if (this.dock !== w) return
      this.close()
      this.host.lost()
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
    void this.showTray()
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
    this.tray?.destroy()
    this.tray = null
    clearInterval(this.screenTimer)
    clearTimeout(this.settleTimer)
    screen.removeListener('display-added', this.onScreen)
    screen.removeListener('display-removed', this.onScreen)
    screen.removeListener('display-metrics-changed', this.onScreen)
    const w = this.window
    this.dock = null
    this.screenState = ''
    this.content = null
    this.last = null
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
    const g = deckGeometry(d.workArea, layoutFor(s, key, label), this.content)
    w.setBounds(g.window)
    w.setOpacity(s.opacity)
    this.last = g
    this.host.geometry(w, g)
    this.pin()
  }

  /** Open the games panel (the height its tiles need) or close it (null) — from the Deck page. */
  expand(content: number | null): void {
    const c = content === null || !Number.isFinite(content) ? null : Math.max(0, Math.min(20_000, content))
    if (c === this.content) return
    this.content = c
    this.place()
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

  /** the menu of the dock (right click) and of the tray icon */
  private menu(): MenuItemConstructorOptions[] {
    return [
      { label: 'Otwórz Lumen', click: () => this.host.openMain() },
      { type: 'separator' },
      ...this.host.settingsMenu(),
      { type: 'separator' },
      { label: 'Wyłącz Decka', click: () => this.host.disable() },
      { type: 'separator' },
      {
        label: 'Uruchamiaj z Windows',
        type: 'checkbox',
        checked: this.host.autostart(),
        // the host refreshes the tray's copy of the menu (also when it is changed from Settings)
        click: (item) => void this.host.setAutostart(item.checked)
      },
      { type: 'separator' },
      { label: 'Zamknij Lumen', click: () => this.host.quit() }
    ]
  }

  /** Build the tray icon's menu again — its checkbox shows the current state (changed from anywhere). */
  refreshMenu(): void {
    this.tray?.setContextMenu(Menu.buildFromTemplate(this.menu()))
  }

  /** The dock's own menu (right click). */
  popupMenu(): void {
    const w = this.window
    if (!w) return
    Menu.buildFromTemplate(this.menu()).popup({ window: w })
  }

  private async showTray(): Promise<void> {
    if (this.tray) return
    try {
      const img = await this.host.icon()
      if (!this.window || this.tray) return // switched off while the icon loaded
      if (img.isEmpty()) log.warn('deck', 'tray icon: no image for Lumen — the icon is blank')
      const t = new Tray(img.isEmpty() ? img : img.resize({ width: 16, height: 16 }))
      t.setToolTip('Lumen')
      t.setContextMenu(Menu.buildFromTemplate(this.menu()))
      t.on('click', () => this.host.openMain())
      this.tray = t
    } catch (e) {
      log.warn('deck', `tray icon: ${(e as Error).message}`)
    }
  }
}
