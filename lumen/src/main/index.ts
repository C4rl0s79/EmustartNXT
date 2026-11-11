import { createHash } from 'node:crypto'
import { app, BrowserWindow, ipcMain, Menu, nativeImage, net, protocol, shell } from 'electron'
import { existsSync, mkdirSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ART_SCHEME, IPC } from '@shared/api'
import { isModeCombo } from '@shared/pad'
import type { UserArtItem } from '@shared/types'
import type { LbTitleInfo } from '@shared/types'
import type { ActionResult, ArtChoice, ArtDataSource, ArtKind, ArtLayout, ArtOption, ArtOptionsResult, DetailsResult, GameArtPrefs, GameDetails, GameFacts, GameRatings, FsEntry, FsListOptions, Game, JobsSnapshot, LibrarySnapshot, PlatformInfo, Prefs, SecretName, Settings, SettingsPatch, SgdbGame, UiMode } from '@shared/types'
import { initLogger, log } from './logger'
import { chooseDataDir, migrateDataDir } from './dataDir'
import { listDir } from './fsBrowse'
import { Limiter } from './net'
import { detectFlavor, Updater } from './updater'
import { cleanLbTitles, ops, PrefsError, PrefsStore } from './store/prefs'
import { SettingsStore } from './store/settings'
import { LibraryService } from './library/service'
import { factsOf, genresPl, StoreMetadataProvider } from './steam/storeMeta'
import { DRY_RUN, openSteam, openSteamUri, shortcutRunUri } from './steam/actions'
import { PAGE_SIZE as SGDB_PAGE_SIZE, pickBestMatch, pickExactMatch, SgdbAuthError, SgdbClient } from './art/sgdb'
import { LaunchBoxService } from './launchbox/service'
import { XInputPoller } from './input/xinput'
import { RawHidPads } from './input/rawhid'
import { foreground } from './input/foreground'
import { editionless, platformForEs, platformForTags } from './launchbox/match'
import { IMAGE_BASE, LB_TYPES, PICKER_TYPES, regionsOfTags, type LbImage } from './launchbox/images'
import { ArtworkService } from './art/artwork'
import { isPlayable } from './steam/manifests'
import { steamId64ToAccountId } from './steam/local'
import { EmustartEngine, resolveEngineCommand } from './emustart/engine'
import { EmustartProvider } from './emustart/provider'
import { emuArtField, emuDetails, isEmuGameId } from './emustart/mapping'
import { registerEmustartIpc } from './emustart/ipc'
import { UnifiedLibrary } from './core/unifiedLibrary'
import { GogProvider, gogPid, isGogId } from './gog/provider'
import { SteamFamily } from './steam/family'
import { applyServer, groupNames, localItems, pendingFiles, type ServerChoices, parseDefaults } from './art/artSync'
import { JsonFile } from './store/jsonFile'
import { registerGogIpc } from './gog/ipc'
import { UiModeManager } from './core/uiMode'
import { DeckWindow, deckScreen } from './deckWindow'
import { LocalMedia } from './localMedia'
import { isAnimated } from './art/animated'
import { deckCandidates, moveDeckGroup, setDeckLayout, syncGroups, type DeckGroupOp, type DeckLayoutStep } from '@shared/deck'
import { buildNav } from '@shared/libraryNav'

const ART_KINDS: ArtKind[] = ['grid', 'hero', 'logo', 'icon']

/**
 * Art picked in one layout shows in the other too, unless that layout has its own choice (TV and desktop
 * keep separate choices). Only real images are borrowed — "no image" / "the source's art" stay per layout.
 */
function borrowable(c: ArtChoice | undefined): ArtChoice | undefined {
  return c && (c.type === 'file' || c.type === 'user' || c.type === 'sgdb' || c.type === 'launchbox' || c.type === 'web') ? c : undefined
}
function withBorrowed(own: GameArtPrefs | undefined, other: GameArtPrefs | undefined): GameArtPrefs | undefined {
  if (!other) return own
  const out: GameArtPrefs = { ...own }
  for (const k of ART_KINDS) if (!out[k]) out[k] = borrowable(other[k])
  return out
}
/** the EmuStart engine finds Lumen's window by this title (in-game menu, return after a game) */
const WINDOW_TITLE = 'Lumen'

protocol.registerSchemesAsPrivileged([
  // corsEnabled + Access-Control-Allow-Origin on every art response: CSS masks (TV themes repaint platform
  // logos through mask-image) are fetched in CORS mode, unlike <img>
  { scheme: ART_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
])

// Data folder: LumenData next to the exe in packaged builds (installer and portable) — settings,
// caches, EmuStart data with the game cache, emulators and BIOS files, temp files (dataDir.ts).
// LUMEN_USER_DATA=<dir>: separate profile for tests/development.
const legacyDataDir = app.getPath('userData')
const dataChoice = chooseDataDir({
  override: process.env.LUMEN_USER_DATA,
  portableDir: process.env.PORTABLE_EXECUTABLE_DIR,
  exeDir: path.dirname(process.execPath),
  packaged: app.isPackaged,
  defaultDir: legacyDataDir
})
const migrated = !process.env.LUMEN_USER_DATA ? migrateDataDir(legacyDataDir, dataChoice.dir) : []
app.setPath('userData', dataChoice.dir)
// Chromium and the engine write temp files here instead of %TEMP%
const tempDir = path.join(dataChoice.dir, 'tmp')
mkdirSync(tempDir, { recursive: true })
app.setPath('temp', tempDir)
// also for Chromium's own temp files and child processes (renderers, GPU, the engine)
process.env.TEMP = tempDir
process.env.TMP = tempDir

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

const userData = app.getPath('userData')
const logFile = initLogger(path.join(userData, 'logs'))
const paths = {
  prefs: path.join(userData, 'prefs.json'),
  settings: path.join(userData, 'settings.json'),
  secrets: path.join(userData, 'secrets.json'),
  account: path.join(userData, 'cache', 'account-library.json'),
  artCache: path.join(userData, 'cache', 'art'),
  metaCache: path.join(userData, 'cache', 'meta'),
  customArt: path.join(userData, 'custom-art'),
  // not under cache/: rebuilding it means a ~110 MB download, so "clear cache" keeps it
  launchbox: path.join(userData, 'launchbox'),
  // EmuStart engine data (config, game cache, profiles) unless the user picks an existing EmuStart folder
  emustartHome: path.join(userData, 'emustart'),
  // last library read from the engine — shown (not playable) when the engine cannot start
  emustartLibrary: path.join(userData, 'emustart-library.json'),
  // last GOG catalog read from the engine (offline library) and EmuStart's platform catalog (shortcut tags)
  gogLibrary: path.join(userData, 'gog-library.json'),
  platforms: path.join(userData, 'platforms.json')
}

/** engine/ next to the app: the project root in development, resources/ when packaged */
const engineRoot = (): string => (app.isPackaged ? process.resourcesPath : app.getAppPath())

const settings = new SettingsStore(paths.settings, paths.secrets)
// EmuStart's pictures on this PC, read by Lumen itself — the engine only fetches a missing one from the server
const localMedia = new LocalMedia({
  home: () => settings.get().emustartHome || paths.emustartHome,
  assets: () =>
    app.isPackaged ? path.join(process.resourcesPath, 'engine', 'EmuStartEngine', '_internal', 'assets') : path.join(engineRoot(), 'engine', 'assets')
})
const prefs = new PrefsStore(paths.prefs)
const library = new LibraryService(settings, paths.account, path.join(userData, 'first-seen.json'))
const family = new SteamFamily(path.join(userData, 'steam-family.json'))
const engine = new EmustartEngine({
  command: () =>
    resolveEngineCommand({
      resourcesPath: app.isPackaged ? process.resourcesPath : undefined,
      appPath: engineRoot(),
      pythonPath: settings.get().pythonPath
    }),
  home: () => settings.get().emustartHome || paths.emustartHome,
  tempDir: () => tempDir,
  windowTitle: WINDOW_TITLE
})
const emu = new EmustartProvider(engine, paths.emustartLibrary, () => ({ order: settings.get().regionOrder, choices: prefs.get().versions }))
const gog = new GogProvider(engine, paths.gogLibrary)
const platformsFile = new JsonFile<PlatformInfo[]>(paths.platforms, () => [])
let platformCatalog: PlatformInfo[] = []
const unified = new UnifiedLibrary(library, emu, gog, { overrides: () => prefs.get().platformOverrides, platforms: () => platformCatalog })
/** GOG game started from Lumen (restore the window when it ends, like Steam games) */
let launchedGog: string | undefined
const updater = new Updater({
  current: app.getVersion(),
  flavor: detectFlavor({ packaged: app.isPackaged, exeDir: path.dirname(process.execPath), portableFile: process.env.PORTABLE_EXECUTABLE_FILE }),
  dataDir: userData,
  // the portable exe runs from a temporary copy — the file to replace and restart is the original
  exe: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath,
  portableFile: process.env.PORTABLE_EXECUTABLE_FILE,
  // development / tests only: local release feed instead of GitHub
  feed: process.env.LUMEN_UPDATE_FEED || undefined,
  quit: () => app.quit()
})
const meta = new StoreMetadataProvider(paths.metaCache, () => settings.get().language)
const launchbox = new LaunchBoxService(paths.launchbox)
const hidPads = new RawHidPads()
const pads = new XInputPoller(() => hidPads.pads())
const sgdb = new SgdbClient(() => settings.getSecret('sgdbApiKey'))
const artwork = new ArtworkService({
  cacheDir: paths.artCache,
  steamPath: () => library.steamPath,
  sgdb,
  priority: () => (sgdbFirstFor('steam') ? 'sgdbFirst' : 'steamFirst'),
  prefsFor: (id) => withBorrowed(prefs.get().art[id], prefs.get().artTv[id]),
  userFile: (sha, ext) => userArtFile(sha, ext),
  userGridDir: () => {
    const { installPath, activeSteamId } = library.current.steam
    const accountId = activeSteamId ? steamId64ToAccountId(activeSteamId) : undefined
    return installPath && accountId ? path.join(installPath, 'userdata', String(accountId), 'config', 'grid') : undefined
  }
})

let win: BrowserWindow | null = null
/** the optional desktop interface (Deck) — a second window, only while Deck is on */
let deck: DeckWindow | null = null
let sessionEnding = false
/** started with Windows for the Deck (G5): the main window stays hidden at start while Deck is on */
const DECK_ARG = '--deck'
const startedForDeck = process.argv.includes(DECK_ARG)
/** the login item: Lumen.exe --deck (from sources: electron.exe <app> --deck) — written in the user's registry, no admin */
// (one fixed value name, "Lumen": the uninstaller removes it — resources/installer.nsh — and a moved folder
// rewrites the same entry instead of adding another)
const LOGIN_NAME = 'Lumen'
const loginItem = (): { path: string; args: string[]; name: string } => ({
  path: process.execPath,
  args: app.isPackaged ? [DECK_ARG] : [app.getAppPath(), DECK_ARG],
  name: LOGIN_NAME
})
function getAutostart(): boolean {
  try {
    return app.getLoginItemSettings(loginItem()).openAtLogin
  } catch {
    return false
  }
}
/** writes the login item; false when Windows refused it (a locked registry, a security program) */
function setAutostart(on: boolean): boolean {
  try {
    app.setLoginItemSettings({ openAtLogin: on, ...loginItem() })
    log.info('deck', `start with Windows: ${on ? 'on' : 'off'}`)
    return true
  } catch (e) {
    log.error('deck', 'start with Windows: could not write the login item', e)
    return false
  } finally {
    deck?.refreshMenu() // the tray icon's menu shows the state, whoever changed it
  }
}
/** Lumen's folder moved (the zip version): the login item still names the old Lumen.exe — written again here */
function refreshAutostartPath(): void {
  try {
    const items = (app.getLoginItemSettings(loginItem()) as { launchItems?: { name: string; path: string; enabled: boolean }[] }).launchItems ?? []
    const mine = items.find((i) => i.name === LOGIN_NAME)
    if (mine?.enabled && path.resolve(mine.path).toLowerCase() !== path.resolve(process.execPath).toLowerCase()) {
      log.info('deck', `start with Windows: Lumen moved (${mine.path}) — the login item follows`)
      setAutostart(true)
    }
  } catch (e) {
    log.warn('deck', `start with Windows: ${(e as Error).message}`)
  }
}
/**
 * A game started from the Deck (G4: the main window does not come back after it): which game, when, and
 * whether the main window was hidden then (an EmuStart game end brings it to the front — hidden again).
 */
let deckLaunch: { gameId: string; at: number; mainHidden: boolean; seenActive: boolean } | null = null
/** a Deck launch that did not get going within this time is forgotten (a later launch of the game is not one) */
const DECK_LAUNCH_MS = 120_000
/** Was this launch asked for from the Deck? Read once — Steam and GOG consume it when their game starts. */
function takeDeckLaunch(gameId: string): boolean {
  const d = deckLaunch
  const yes = !!d && d.gameId === gameId && Date.now() - d.at < DECK_LAUNCH_MS
  if (yes) deckLaunch = null
  return yes
}
/** the Steam / GOG game now running was started from the Deck: no minimize, no restore after it */
let steamViaDeck = false
let gogViaDeck = false
let modes: UiModeManager | null = null
let launchedAppId: number | undefined
/** Steam game whose controller profile hid devices (disabled in Windows until the game ends) */
let hiddenForAppId: number | undefined
let hiddenWatchdog: NodeJS.Timeout | undefined
const artRev = new Map<string, number>()

/** what the Deck window listens to — the library, prefs, settings and art; never pad state, focus or modes */
const DECK_CHANNELS: ReadonlySet<string> = new Set([IPC.librarySnapshot, IPC.prefsChanged, IPC.settingsChanged, IPC.artChanged])

function send(channel: string, ...args: unknown[]): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
  const d = deck?.window
  if (d && DECK_CHANNELS.has(channel)) d.webContents.send(channel, ...args)
}

/** Deck switched on or off: its window follows; with Deck off a hidden main window comes back (nothing else is on screen). */
function applyDeck(): void {
  deck?.sync()
  scheduleDeckSync()
  if (!settings.get().deck.enabled && win && !win.isDestroyed() && !win.isVisible()) restoreWindow()
}

/** names of the library's collections for the server panel; null until the library is read (keeps the server's names) */
function currentGroupNames(): Record<string, string> | null {
  const s = unified.current
  return s.games.length ? groupNames(buildNav(s.games, prefs.get(), s.collections)) : null
}

/** library subgroups that can be Deck tabs, from the library as it is now */
function currentDeckCandidates(): ReturnType<typeof deckCandidates> {
  const s = unified.current
  return deckCandidates(buildNav(s.games, prefs.get(), s.collections))
}

/**
 * An EmuStart game started from the Deck: the engine brings Lumen's window to the front when the game ends
 * (and for its questions) — a window hidden before the launch is hidden again after the game (G4); a save
 * conflict waiting for the player shows it (and then it stays).
 */
function followDeckLaunch(j: JobsSnapshot): void {
  const d = deckLaunch
  if (!d) return
  const job = j.jobs.find((x) => x.kind === 'emuLaunch' && x.gameId === d.gameId)
  const ended = !!job && (job.state === 'done' || job.state === 'error' || job.state === 'cancelled')
  // only this launch counts: a game seen going (not the previous run's finished state); never got going → forgotten
  if (job && !ended) d.seenActive = true
  if (!d.seenActive) {
    if (Date.now() - d.at > DECK_LAUNCH_MS) deckLaunch = null
    return
  }
  if (!job) return
  if (job.state === 'waiting') {
    // shown once, when the question comes — not again with every progress update
    if (d.mainHidden) {
      d.mainHidden = false
      restoreWindow()
    }
  } else if (ended) {
    deckLaunch = null
    // an error is left on screen (the engine showed the window with it); a finished game hides it again
    if (job.state === 'done' && d.mainHidden)
      setTimeout(() => {
        if (win && !win.isDestroyed() && win.isVisible() && settings.get().deck.enabled) win.hide()
      }, 400)
  }
}

// New library subgroups become Deck tabs in the main process — the one writer of the settings, so a tab
// change made in another window is never overwritten by a stale copy. Throttled: snapshots come often.
let deckSyncTimer: NodeJS.Timeout | undefined
function scheduleDeckSync(): void {
  if (deckSyncTimer || !settings.get().deck.enabled) return
  deckSyncTimer = setTimeout(() => {
    deckSyncTimer = undefined
    const cur = settings.get().deck
    if (!cur.enabled) return
    const groups = syncGroups(cur.groups, currentDeckCandidates())
    if (groups !== cur.groups) void patchSettings({ deck: { groups } }).catch((e) => log.error('deck', 'tabs sync failed', e))
  }, 1500)
}

function loadDeckPage(w: BrowserWindow): void {
  if (process.env.ELECTRON_RENDERER_URL) void w.loadURL(`${process.env.ELECTRON_RENDERER_URL}/deck.html`)
  else void w.loadFile(path.join(__dirname, '../renderer/deck.html'))
}

function findGame(gameId: string): Game | undefined {
  return unified.game(gameId)
}

function steamAppIdOf(gameId: string): number | undefined {
  const m = /^steam:(\d+)$/.exec(gameId)
  return m ? Number(m[1]) : undefined
}

function fail(error: string): ActionResult {
  return { ok: false, error }
}

// ---------------- window ----------------

function createWindow(): void {
  const s = settings.get()
  win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#0a0c11',
    title: WINDOW_TITLE,
    autoHideMenuBar: true,
    // started with Windows for the Deck the window stays hidden — going fullscreen would show it
    fullscreen: s.startFullscreen && !(startedForDeck && s.deck.enabled),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: true
    }
  })
  Menu.setApplicationMenu(null)
  win.on('page-title-updated', (e) => e.preventDefault())
  // with Deck on, closing the window hides it: Lumen keeps running on the desktop (Deck menu → Zamknij Lumen)
  // Windows ending the session closes the window without before-quit: never hold it up (session-end only —
  // query-session-end comes also for a shutdown the player then cancels)
  win.on('session-end', () => (sessionEnding = true))
  win.on('close', (e) => {
    if (shutDown || sessionEnding || !settings.get().deck.enabled || !deck?.window) return
    e.preventDefault()
    win?.hide()
    log.info('window', 'hidden (Deck is on)')
  })
  win.once('ready-to-show', () => {
    // started with Windows for the Deck: the window is there (it runs the games), shown from the tray / the dock
    const hidden = startedForDeck && settings.get().deck.enabled
    if (win && !hidden) activateWindow(win)
    if (hidden) log.info('window', 'started with Windows for the Deck — hidden')
    else if (settings.get().startMode === 'fullscreen') modes?.setMode('fullscreen')
  })
  win.on('focus', () => {
    send(IPC.appFocus, true)
    // keyboard focus belongs to the interface (both layouts are the window's own page)
    win?.webContents.focus()
  })
  win.on('minimize', () => log.info('window', 'minimized'))
  win.on('restore', () => log.info('window', 'restored'))
  win.on('blur', () => {
    send(IPC.appFocus, false)
    // who took the focus (diagnosis: pad silent although Lumen stays on top)
    setTimeout(() => {
      if (!win || win.isDestroyed() || win.isFocused()) return
      const fg = foreground(ownHandle())
      if (fg) log.info('window', `focus lost to: ${fg.desc}${fg.other ? '' : ' — pad stays on'}`)
    }, 300)
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(process.env.ELECTRON_RENDERER_URL ?? 'file:')) e.preventDefault()
  })
  win.webContents.on('before-input-event', (_e, input) => hotkeys(input, win!.webContents))
  win.webContents.on('render-process-gone', (_e, d) => log.error('app', `renderer gone: ${d.reason}`))

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'))

  modes = new UiModeManager(win)
  modes.on('mode', (mode: UiMode, selection: string | null) => send(IPC.uiMode, mode, selection))
}

/** F10 / View+Start: switch interface; F11: window fullscreen (desktop); F12: DevTools (development). */
function hotkeys(input: Electron.Input, wc: Electron.WebContents): void {
  if (input.type !== 'keyDown') return
  if (input.key === 'F10') modes?.toggle()
  if (input.key === 'F11' && modes?.mode !== 'fullscreen') win?.setFullScreen(!win.isFullScreen())
  if (input.key === 'F12' && !app.isPackaged) wc.toggleDevTools()
}

/**
 * Show the window with keyboard focus. Windows does not hand the foreground to a window of a
 * process the player did not start directly (the portable launcher unpacks and starts Lumen, the
 * update task restarts it): the window appeared without focus and the pad stayed silent (pad
 * input only while Lumen has focus). Steps Windows allows, each only when the previous one failed.
 */
function activateWindow(w: BrowserWindow): void {
  if (w.isMinimized()) w.restore()
  w.show()
  w.focus()
  w.webContents.focus()
  if (w.isFocused()) return
  w.setAlwaysOnTop(true)
  w.show()
  w.focus()
  w.setAlwaysOnTop(false)
  setTimeout(() => {
    if (w.isDestroyed() || w.isFocused()) return
    w.minimize()
    w.restore()
    w.focus()
    log.info('window', `focus at start: ${w.isFocused() ? 'yes' : 'no (click the window)'}`)
  }, 300)
}

function ownHandle(): bigint {
  const b = win && !win.isDestroyed() ? win.getNativeWindowHandle() : null
  return b ? (b.length >= 8 ? b.readBigUInt64LE(0) : BigInt(b.readUInt32LE(0))) : 0n
}

// pad without focus: Lumen visible and no other application's real window in front (checked at most every 250 ms)
let fgAt = 0
let fgOk = false
function padWithoutFocus(): boolean {
  const now = Date.now()
  if (now - fgAt > 250) {
    fgAt = now
    const fg = win && win.isVisible() ? foreground(ownHandle()) : null
    fgOk = !!fg && !fg.other
  }
  return fgOk
}

let refocusAt = 0
function refocus(): void {
  if (!win || win.isDestroyed() || Date.now() - refocusAt < 2000) return
  refocusAt = Date.now()
  activateWindow(win)
}

function restoreWindow(): void {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

// ---------------- image protocol ----------------

/** pictures that come through the EmuStart engine: platform logos / console photos, group art, uploaded art */
const FROM_ENGINE = /^\/(navgrp|emusys|usr)%3A/i
/** right after it starts, the engine does not always serve its files yet (seen: a platform logo 404 ~0.1 s after 'ready') */
const ENGINE_SETTLE_MS = 15_000
const ENGINE_RETRY_MS = 1500
let engineReadyAt = 0

function registerArtProtocol(): void {
  protocol.handle(ART_SCHEME, async (req) => {
    const t0 = Date.now()
    const where = new URL(req.url).pathname
    let res = await artResponse(req)
    // asked again a couple of times while the engine settles — a missing picture stayed a name for the session
    for (let i = 0; i < 2 && res.status !== 200 && FROM_ENGINE.test(where) && engineReadyAt && Date.now() - engineReadyAt < ENGINE_SETTLE_MS; i++) {
      await new Promise((r) => setTimeout(r, ENGINE_RETRY_MS))
      res = await artResponse(req)
    }
    if (Date.now() - t0 > 1500) log.info('art', `slow ${Date.now() - t0} ms: ${where}`)
    // a group's or a platform's picture that does not come is shown as a name for the whole session — say why
    if (res.status !== 200 && FROM_ENGINE.test(where))
      log.info('art', `no picture ${decodeURIComponent(where)}: HTTP ${res.status} after ${Date.now() - t0} ms (engine ${engine.state})`)
    const headers = new Headers(res.headers)
    headers.set('Access-Control-Allow-Origin', '*')
    return new Response(res.body, { status: res.status, headers })
  })
}

// Posters on lists come as small copies: a full file arrives in many chunks and the page re-processes the image on
// every one — seconds of stutter on a long list, measured with a trace. Made once by the engine (Pillow), kept on disk.
const thumbLimiter = new Limiter(3, 'art-thumb', true)
async function artThumb(file: string): Promise<string> {
  if (engine.state !== 'ready' || /\.(gif|webm|mp4)$/i.test(file)) return file
  const st = await fs.stat(file).catch(() => null)
  if (!st || st.size < 150_000) return file
  const dst = path.join(paths.artCache, 'thumbs', `${createHash('sha1').update(`${file}|${st.mtimeMs}`).digest('hex')}.webp`)
  if (await fs.stat(dst).catch(() => null)) return dst
  const r = await thumbLimiter.run(() => engine.call<{ ok?: boolean }>('art_thumb', [file, dst, 540], 20_000)).catch(() => null)
  return r?.ok ? dst : file
}

const WEB_ART = /^https:\/\/(images\.igdb\.com|cdn\.thegamesdb\.net)\//

async function artResponse(req: Request): Promise<Response> {
  try {
    const u = new URL(req.url)
    const [, rawId, kind] = u.pathname.split('/')
    const gameId = decodeURIComponent(rawId ?? '')
    if (!ART_KINDS.includes(kind as ArtKind)) return new Response('bad kind', { status: 400 })
    // a picture from the player's own key: through this process, the image server refuses the window's own requests
    if (gameId.startsWith('web:')) {
      if (!WEB_ART.test(gameId.slice(4))) return new Response('bad url', { status: 400 })
      const f = await artwork.fromUrl('web', kind as ArtKind, gameId.slice(4))
      return f ? fileResponse(f) : new Response('none', { status: 404 })
    }
    const usr = /^usr:([0-9a-f]{64})\.(png|jpg|webp|gif)$/.exec(gameId)
    if (usr) {
      const f = await userArtFile(usr[1], usr[2])
      return f ? fileResponse(f) : new Response('none', { status: 404 })
    }
    // the player's own art of a library group in the TV layout (PC, Konsole, GOG, a collection…): only a file
    if (gameId.startsWith('navgrp:')) return (await tvArt(gameId, kind as ArtKind)) ?? new Response('none', { status: 404 })
    if (gameId.startsWith('emusys:')) {
      // platform logo / console photo from the EmuStart server (TV system carousel, Deck tabs); engineMedia
      // waits for the engine when it is still starting
      const es = gameId.slice(7)
      const logo = kind === 'logo' ? emu.systemLogo(es) : kind === 'hero' ? emu.systemConsole(es) : undefined
      if (!logo) return new Response('not found', { status: 404 })
      return (await engineMedia(logo)) ?? new Response('not found', { status: 404 })
    }
    if (u.searchParams.get('tv') === '1') {
      const own = await tvArt(gameId, kind as ArtKind)
      if (own) return own
    }
    if (isEmuGameId(gameId)) return await emuArt(gameId, kind)
    // GOG: the server's art (GOG Manager's folder) first, SteamGridDB by name without it — the other
    // way round when "SteamGridDB first" is on for GOG
    const isGog = isGogId(gameId)
    const gogSgdbFirst = isGog && sgdbFirstFor('gog')
    const gogOwn = (): Promise<Response | null> => gogArt(gameId, kind as ArtKind, u.searchParams.get('tv') === '1')
    if (isGog && !gogSgdbFirst) {
      const own = await gogOwn()
      if (own) return own
    }
    const game = findGame(gameId)
    if (gogSgdbFirst && !(await artwork.titledDecided(gameId, kind as ArtKind))) {
      // a SteamGridDB lookup not made yet never holds the poster back: the server's art now, the lookup in
      // the background (the image is swapped when it finds something) — as for EmuStart games
      void artwork.resolve(gameId, undefined, kind as ArtKind, game?.name).then((f) => f && notifyArt(gameId))
      const own = await gogOwn()
      if (own) return own
    }
    const shortcutId = /^shortcut:(\d+)$/.exec(gameId)
    const file = shortcutId
      ? await artwork.resolve(gameId, undefined, kind as ArtKind, game?.name, Number(shortcutId[1]))
      : await artwork.resolve(gameId, game?.appId || steamAppIdOf(gameId), kind as ArtKind, game?.name)
    if (!file && gogSgdbFirst) return (await gogOwn()) ?? new Response('not found', { status: 404 })
    if (!file) return new Response('not found', { status: 404 })
    // anim=1 (Deck tiles, desktop lists — the player wants animated posters to move): an animated poster as
    // it is, not its list copy (first frame). Looked at only where a list copy would be made of a file that
    // can be animated: PNG / WebP of 150 KB or more (a JPEG never is; GIF / video get no list copy anyway)
    const thumb = u.searchParams.get('thumb') === '1'
    const keepMoving =
      thumb && u.searchParams.get('anim') === '1' && /\.(png|apng|webp)$/i.test(file) && ((await fs.stat(file).catch(() => null))?.size ?? 0) >= 150_000 && (await isAnimated(file))
    const served = thumb && !keepMoving ? await artThumb(file) : file
    const res = await net.fetch(pathToFileURL(served).toString())
    const headers = new Headers(res.headers)
    headers.set('Cache-Control', 'max-age=31536000')
    return new Response(res.body, { status: 200, headers })
  } catch (e) {
    log.warn('art', `protocol error: ${(e as Error).message}`)
    return new Response('error', { status: 500 })
  }
}

/**
 * EmuStart game art comes from the engine (its offline copy of the server's media). Requests go
 * through Node with a limit — a poster grid asked Chromium's network service for dozens at once
 * (net::ERR_INSUFFICIENT_RESOURCES, posters stayed empty) — and recent images stay in memory.
 */
const emuArtLimit = new Limiter(6, 'emustart-art', true)
/** recent EmuStart images in memory, least recently shown dropped first (a byte budget, not a count) */
const emuArtCache = new Map<string, { type: string; body: Buffer }>()
const EMU_ART_BUDGET = 256 * 1024 * 1024
let emuArtBytes = 0
function emuArtGet(url: string): { type: string; body: Buffer } | undefined {
  const hit = emuArtCache.get(url)
  if (hit) {
    emuArtCache.delete(url)
    emuArtCache.set(url, hit)
  }
  return hit
}
function emuArtPut(url: string, hit: { type: string; body: Buffer }): void {
  emuArtCache.set(url, hit)
  emuArtBytes += hit.body.length
  for (const [k, v] of emuArtCache) {
    if (emuArtBytes <= EMU_ART_BUDGET) break
    emuArtCache.delete(k)
    emuArtBytes -= v.body.length
  }
}

/** Names to look a game up in SteamGridDB: its LaunchBox name and the titles of its versions. */
function emuTitles(gameId: string): string[] {
  const rows = [emu.row(gameId), ...emu.versionsOf(gameId).map((v) => emu.row(v.id))]
  const out = new Set<string>()
  for (const r of rows) if (r?.title) out.add(r.title)
  const lb = emuLbId(gameId)
  const lbName = lb ? launchbox.nameById(lb) : undefined
  return lbName ? [lbName, ...[...out].filter((n) => n !== lbName)] : [...out]
}

/**
 * LaunchBox Games DB id of an EmuStart game: from the server's metadata (any version), else found
 * by title on the system's platform in the local LaunchBox database (systems the server has no
 * metadata for: Mega Drive, Game Boy, Atari…). A title match is remembered while the program runs.
 */
const emuLbMatch = new Map<string, number>()
function emuLbId(gameId: string): number | undefined {
  const own = emu.row(gameId)?.lb || emu.versionsOf(gameId).map((v) => emu.row(v.id)?.lb).find(Boolean)
  if (own) return own
  const known = emuLbMatch.get(gameId)
  if (known !== undefined) return known || undefined
  const row = emu.row(gameId)
  const platform = row ? platformForEs(row.es) : undefined
  if (!row?.title || !platform) return undefined
  const hit = launchbox.find(row.title, platform)
  // a miss is remembered only with the database present (it may be downloaded later)
  if (hit || launchbox.ready) emuLbMatch.set(gameId, hit?.id ?? 0)
  return hit?.id
}

/** SteamGridDB before the source's own art for games from this data source (Ustawienia → Grafiki) */
function sgdbFirstFor(src: ArtDataSource): boolean {
  const s = settings.get()
  return s.artPriority === 'sgdbFirst' && !s.sgdbFirstOff.includes(src)
}

/** what a source's details lack, filled in from LaunchBox (description, genre, year, rating…) */
function fillFromLaunchBox(d: GameDetails, lb: GameDetails): GameDetails {
  return {
    ...d,
    descriptionText: d.descriptionText || lb.descriptionText,
    genres: d.genres?.length ? d.genres : lb.genres,
    releaseDate: d.releaseDate || lb.releaseDate,
    developers: d.developers?.length ? d.developers : lb.developers,
    publishers: d.publishers?.length ? d.publishers : lb.publishers,
    players: d.players || lb.players,
    rating: d.rating ?? lb.rating,
    ratingCount: d.ratingCount ?? lb.ratingCount,
    esrb: d.esrb || lb.esrb,
    coop: d.coop ?? lb.coop,
    releaseType: d.releaseType || lb.releaseType,
    launchboxId: d.launchboxId ?? lb.launchboxId
  }
}

/** EmuStart details with what the server lacks filled in from LaunchBox */
function withLaunchBox(gameId: string, r: DetailsResult): DetailsResult {
  const lbId = emuLbId(gameId)
  const lb = lbId ? launchbox.detailsById(lbId) : null
  if (!lb) return r
  if (!r.ok) return { ok: true, details: { ...lb, name: emu.row(gameId)?.title ?? lb.name }, stale: false }
  return { ...r, details: fillFromLaunchBox(r.details, lb) }
}

/** the name to look a GOG game / shortcut up in LaunchBox: the administrator's (server) or the store's */
function lbTitle(gameId: string, name: string): string {
  return prefs.get().lbTitles[gameId] || name
}

/** list facts from LaunchBox per game (cleared when the administrator changes a game's name) */
const lbFacts = new Map<string, GameFacts>()
/** this device may change LaunchBox names (the engine's answer, from the last sync) */
let lbTitlesAdmin = false

/** the administrator's LaunchBox names from the server: a local copy (offline too) */
/** bumped by every change saved from this device: a sync started before it must not overwrite it */
let lbTitlesRev = 0

async function syncLbTitles(): Promise<void> {
  const rev = lbTitlesRev
  const r = await engine.call<{ titles?: Record<string, string>; admin?: boolean }>('art_lb_titles', [], 30_000).catch(() => null)
  if (!r?.titles || rev !== lbTitlesRev) return
  lbTitlesAdmin = !!r.admin
  const next = cleanLbTitles(r.titles)
  const before = prefs.get().lbTitles
  if (JSON.stringify(next) === JSON.stringify(before)) return
  for (const id of new Set([...Object.keys(before), ...Object.keys(next)])) if (before[id] !== next[id]) lbFacts.delete(id)
  await updatePrefs((p) => ({ ...p, lbTitles: next }))
}

/**
 * LaunchBox entry of a GOG game, on Windows, then MS-DOS (GOG sells many DOS classics): the closest
 * edition among entries of the same title ("… Game of the Year Edition" ↔ the plain title), else the
 * usual title lookup (alternate names, parts after " - "), also without the store edition. Needs the database.
 */
function gogLaunchBox(name: string): GameDetails | null {
  for (const platform of ['Windows', 'MS-DOS']) {
    const d = launchbox.edition(name, platform)
    if (d) return d
    // the usual title lookup (parts after " - ", prefix), name by name — stops at the first hit
    for (const n of [name, ...editionless(name)]) {
      const hit = launchbox.details(n, platform)
      if (hit) return hit
    }
  }
  return null
}

/** LaunchBox images of an EmuStart game, best first: the shown version's region, then preference */
function emuLbImages(gameId: string, types: readonly string[]): LbImage[] {
  const lb = emuLbId(gameId)
  if (!lb) return []
  return launchbox.images(lb, types, settings.get().regionOrder ?? 'europe', regionsOfTags(emu.row(gameId)?.tags ?? ''))
}

/** First LaunchBox image of these types that downloads, as a response */
async function emuLbArt(gameId: string, kind: ArtKind, types: readonly string[]): Promise<Response | null> {
  for (const img of emuLbImages(gameId, types).slice(0, 2)) {
    const f = await artwork.fromUrl(gameId, kind, img.url)
    if (f) return fileResponse(f)
  }
  return null
}

const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }
/**
 * GOG game art from the EmuStart server (GOG Manager's game folder: box art, background, logo, icon; the engine
 * keeps a copy, so it shows offline too). The player's own choice comes first; without server art —
 * SteamGridDB by name, as before.
 */
async function gogArt(gameId: string, k: ArtKind, tv: boolean): Promise<Response | null> {
  const chosen = (tv ? prefs.get().artTv[gameId]?.[k] : undefined) ?? withBorrowed(prefs.get().art[gameId], prefs.get().artTv[gameId])?.[k]
  const pid = gogPid(gameId)
  if (chosen || !pid || !(await engineReady())) return null
  const info = gog.info(gameId)
  if (info?.art && !info.art.includes(k)) return null
  const r = await engine.call<{ path?: string }>('gog_art', [pid, k], 70_000).catch(() => null)
  return r?.path ? fileResponse(r.path) : null
}

async function userArtFile(sha: string, ext: string): Promise<string | null> {
  // on this PC already (downloaded once): read from the disk — the engine only for a missing one
  const local = localMedia.userArt(sha, ext)
  if (local) return local
  if (!(await engineReady())) {
    log.info('art', `uploaded picture ${sha.slice(0, 12)}: engine not ready (${engine.state})`)
    return null
  }
  const r = await engine.call<{ path?: string; reason?: string }>('art_user_file', [sha, ext], 90_000).catch((e: Error) => ({ path: '', reason: e.message }))
  if (!r?.path) log.info('art', `uploaded picture ${sha.slice(0, 12)}: no file${r?.reason ? ` (${r.reason})` : ''}`)
  return r?.path || null
}

// ---- art choices and own images on the server (art/artSync.ts); nothing here blocks the interface ----
let artSyncTimer: NodeJS.Timeout | undefined
let artSyncing = false

function scheduleArtSync(ms = 2000): void {
  clearTimeout(artSyncTimer)
  artSyncTimer = setTimeout(() => void syncArt(), ms)
}

async function syncArt(): Promise<void> {
  if (artSyncing || engine.state !== 'ready' || !emu.summary().server?.ok) return
  artSyncing = true
  try {
    for (const [layout, gameId, kind, file] of pendingFiles(prefs.get())) {
      const r = await engine.call<{ ok?: boolean; sha?: string; ext?: string; reason?: string }>('art_user_upload', [file, gameId, kind], 150_000)
      if (!r.sha || !r.ext) {
        log.warn('art', `upload ${gameId} ${kind}: ${r.reason ?? 'nieudane'}`)
        continue
      }
      const sha = r.sha
      const ext = r.ext
      await prefs.update((p) => {
        const map = layout === 'tv' ? 'artTv' : 'art'
        if (p[map][gameId]?.[kind]?.type !== 'file') return p // changed meanwhile
        return { ...p, [map]: { ...p[map], [gameId]: { ...p[map][gameId], [kind]: { type: 'user', sha, ext } } } }
      })
    }
    await syncLbTitles()
    const r = await engine.call<{ ok?: boolean; choices?: ServerChoices }>('art_user_sync', [localItems(prefs.get()), currentGroupNames()], 60_000)
    if (!r.choices) return
    const d = await engine.call<{ defaults?: Record<string, { sha?: string; ext?: string }> }>('art_user_defaults', [], 30_000).catch(() => null)
    if (d?.defaults) {
      const artDefaults = parseDefaults(d.defaults)
      const before = prefs.get().artDefaults
      if (JSON.stringify(artDefaults) !== JSON.stringify(before)) {
        await updatePrefs((p) => ({ ...p, artDefaults }))
        for (const id of new Set([...Object.keys(before), ...Object.keys(artDefaults)])) bumpArt(id)
      }
    }
    const { prefs: next, changed } = applyServer(prefs.get(), r.choices)
    if (changed.length) {
      await updatePrefs(() => next)
      changed.forEach((id) => bumpArt(id))
    } else send(IPC.prefsChanged, prefs.get())
  } catch (e) {
    log.warn('art', `sync: ${(e as Error).message}`)
  } finally {
    artSyncing = false
  }
}

async function fileResponse(file: string): Promise<Response> {
  const type = IMAGE_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
  return new Response(new Uint8Array(await fs.readFile(file)), { status: 200, headers: { 'Content-Type': type, 'Cache-Control': 'max-age=86400' } })
}

/**
 * EmuStart art, in order:
 *  - poster: the player's choice → SteamGridDB (600x900, matched strictly by title) → the server's
 *    box art → LaunchBox box front. Box art is a real box shape (3DO longbox ~1:2, CD case ~1:1),
 *    the interface shows it whole over a blurred copy;
 *  - background: choice → SteamGridDB → LaunchBox "Fanart - Background" → the server's screenshot →
 *    LaunchBox screenshot;
 *  - logo: choice → the server (LaunchBox Clear Logo) → LaunchBox → SteamGridDB.
 * With "SteamGridDB first" off for this source (Ustawienia → Grafiki) poster and background go like
 * the logo: SteamGridDB only after the server's and LaunchBox's art.
 * LaunchBox images go by the LaunchBox id from the server's metadata (no title guessing). The first
 * SteamGridDB lookup can take a while: after a short wait the next source is shown and the image is
 * swapped in when it arrives (art revision bump).
 */
async function emuArt(gameId: string, kind: string): Promise<Response> {
  const k = kind as ArtKind
  const names = emuTitles(gameId)
  const sgdbFirst = sgdbFirstFor('launchbox')
  const auto = k !== 'logo' && sgdbFirst
  // a SteamGridDB lookup not made yet never holds the poster back: the source's art now, the
  // lookup in the background (the poster is swapped when it finds something)
  const decided = !auto || (await artwork.titledDecided(gameId, k))
  const titled = artwork.resolveTitled(gameId, k, names, auto)
  const first = decided ? await titled : 'late'
  if (first === 'late') void titled.then((f) => f && notifyArt(gameId))
  else if (first === null) return new Response('none', { status: 404 })
  else if (first) return fileResponse(first)
  // the player chose "Grafika z serwera EmuStart" (or picked one on the server): exactly the server's
  // art first — LaunchBox only when the server has none of this kind
  const serverChosen = prefs.get().art[gameId]?.[k]?.type === 'steam'
  const steps: (() => Promise<Response | null>)[] =
    serverChosen && k === 'hero'
      ? [() => engineArt(gameId, kind), () => emuLbArt(gameId, k, LB_TYPES.fanart), () => emuLbArt(gameId, k, LB_TYPES.screenshot)]
      : k === 'grid'
      ? [() => engineArt(gameId, kind), () => emuLbArt(gameId, k, LB_TYPES.box)]
      : k === 'hero'
        ? [() => emuLbArt(gameId, k, LB_TYPES.fanart), () => engineArt(gameId, kind), () => emuLbArt(gameId, k, LB_TYPES.screenshot)]
        : k === 'logo'
          ? [() => engineArt(gameId, kind), () => emuLbArt(gameId, k, LB_TYPES.logo)]
          : []
  for (const step of steps) {
    const r = await step()
    if (r) return r
  }
  if ((k === 'logo' || !sgdbFirst) && first !== 'late') {
    const f = await artwork.resolveTitled(gameId, k, names, true)
    if (f) return fileResponse(f)
  }
  return new Response('not found', { status: 404 })
}

const layoutOf = (layout: unknown): ArtLayout => (layout === 'tv' ? 'tv' : 'desktop')

/**
 * The TV layout's own art (a cover shown whole, a screenshot slot, a logo — not the desktop's 2:3
 * poster and wide background): the TV choice, else for EmuStart games LaunchBox first (box front,
 * background / screenshot, Clear Logo), then the server's art. null: nothing of its own — as on the
 * desktop (Steam games, EmuStart games with neither).
 */
async function tvArt(gameId: string, k: ArtKind): Promise<Response | null> {
  const choice =
    prefs.get().artTv[gameId]?.[k] ?? borrowable(prefs.get().art[gameId]?.[k]) ?? (k === 'logo' || k === 'hero' ? prefs.get().artDefaults[gameId]?.[k] : undefined)
  if (choice?.type === 'none') return new Response('none', { status: 404 })
  if (choice?.type === 'file' && (await fs.stat(choice.file).catch(() => null))) return fileResponse(choice.file)
  if (choice?.type === 'user') {
    const f = await userArtFile(choice.sha, choice.ext)
    if (f) return fileResponse(f)
  }
  if (choice?.type === 'sgdb' || choice?.type === 'launchbox' || choice?.type === 'web') {
    const f = await artwork.fromUrl(gameId, k, choice.url)
    if (f) return fileResponse(f)
  }
  if (!isEmuGameId(gameId)) return null
  const server = (): Promise<Response | null> => engineArt(gameId, k)
  const lb = (types: readonly string[]) => (): Promise<Response | null> => emuLbArt(gameId, k, types)
  const steps =
    choice?.type === 'steam'
      ? [server]
      : k === 'grid'
        ? [lb(LB_TYPES.box), server]
        : k === 'hero'
          ? [lb(LB_TYPES.fanart), lb(LB_TYPES.screenshot), server]
          : k === 'logo'
            ? [lb(LB_TYPES.logo), server]
            : []
  for (const step of steps) {
    const r = await step()
    if (r) return r
  }
  return null
}

/** how long a picture missing on this PC waits for the engine to fetch it, at start */
const ENGINE_WAIT_MS = 30_000
let engineWait: Promise<boolean> | null = null

/**
 * true once the engine is ready — at once when it is. Images from the engine (platform logos, the server's
 * art, art uploaded to the server) are asked for before it is up: they wait for it instead of failing, or
 * a failed image stayed missing for the whole session. Whether the engine will come is the setting's call
 * (until start() gets going it still reports 'disabled'); 'missing' / 'error' end the wait at once. One
 * shared wait (and one listener) for every request.
 */
function engineReady(): Promise<boolean> {
  if (engine.state === 'ready') return Promise.resolve(true)
  if (!settings.get().emustartEnabled || engine.state === 'missing' || engine.state === 'error') return Promise.resolve(false)
  if (!engineWait)
    engineWait = new Promise((resolve) => {
      const done = (ok: boolean): void => {
        clearTimeout(timer)
        engine.off('state', onState)
        engineWait = null
        resolve(ok)
      }
      const onState = (st: string): void => {
        if (st === 'ready') done(true)
        else if (st === 'missing' || st === 'error') done(false)
      }
      const timer = setTimeout(() => done(false), ENGINE_WAIT_MS)
      engine.on('state', onState)
    })
  return engineWait
}

/**
 * A file from the engine's media (offline copy of the server's media), kept in memory. The engine
 * keeps it on disk and fetches a missing one from the server itself. null: not there / engine error.
 */
async function engineMedia(url: string): Promise<Response | null> {
  // on this PC: read from the disk, no engine involved (shown at once, also before the engine is up)
  const local = localMedia.read(url)
  if (local) return new Response(new Uint8Array(local.body), { status: 200, headers: { 'Content-Type': local.type, 'Cache-Control': 'max-age=86400' } })
  // not here yet: the engine fetches it from the server (into the same store), then serves it
  if (!(await engineReady())) return null
  const full = new URL(url, engine.baseUrl).toString()
  let hit = emuArtGet(full)
  if (!hit) {
    try {
      hit = await emuArtLimit.run(async () => {
        // the engine is local — also in the "no network" test mode (LUMEN_OFFLINE)
        const res = await fetch(full, { signal: AbortSignal.timeout(60_000) })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return { type: res.headers.get('content-type') ?? 'image/webp', body: Buffer.from(await res.arrayBuffer()) }
      })
    } catch {
      return null
    }
    emuArtPut(full, hit)
  }
  return new Response(new Uint8Array(hit.body), { status: 200, headers: { 'Content-Type': hit.type, 'Cache-Control': 'max-age=86400' } })
}

/** The engine's offline copy of the server's media (box art, screenshot, Clear Logo). */
async function engineArt(gameId: string, kind: string): Promise<Response | null> {
  const field = emuArtField(kind)
  const row = emu.row(gameId)
  // a game with several versions: art of the shown version, else of any version that has it
  const url = (field && (row?.[field] || emu.versionsOf(gameId).map((v) => emu.row(v.id)?.[field]).find(Boolean))) || ''
  return url ? engineMedia(url) : null
}

function bumpArt(gameId: string, kind?: ArtKind): void {
  artwork.invalidate(gameId, kind)
  notifyArt(gameId)
}

/** Tell the interface to reload a game's art (a new image is ready; nothing to forget). */
function notifyArt(gameId: string): void {
  const rev = (artRev.get(gameId) ?? 0) + 1
  artRev.set(gameId, rev)
  send(IPC.artChanged, gameId, rev)
}

/** Shortcuts on the first page of the path picker. */
function places(): FsEntry[] {
  const out: FsEntry[] = [
    { name: 'Folder danych Lumen', path: userData, kind: 'place' },
    { name: 'Dane EmuStart', path: settings.get().emustartHome || paths.emustartHome, kind: 'place' }
  ]
  for (const [name, key] of [['Pulpit', 'desktop'], ['Dokumenty', 'documents'], ['Pobrane', 'downloads']] as const) {
    try {
      out.push({ name, path: app.getPath(key), kind: 'place' })
    } catch {
      /* not available */
    }
  }
  return out.filter((p) => existsSync(p.path))
}

// ---------------- actions shared by both interfaces ----------------

/** Start a Steam game (or a non-Steam shortcut) through the Steam client. */
async function playSteam(gameId: string): Promise<ActionResult> {
  const game = findGame(gameId)
  if (!game) return fail('Nie znaleziono gry w bibliotece.')
  if (game.source === 'demo') return fail('To jest gra demonstracyjna — nie można jej uruchomić.')
  if (game.source === 'emustart') return fail('Gry z serwera EmuStart uruchamia EmuStart.')
  if (game.source === 'gog') return fail('Gry GOG uruchamia silnik EmuStart, nie Steam.')
  if (library.current.steam.status === 'notInstalled') return fail('Nie znaleziono klienta Steam na tym komputerze.')
  if (!isPlayable(game.installState))
    return fail(game.source === 'shortcut' ? 'Nie znaleziono programu tego skrótu na dysku.' : 'Gra nie jest gotowa do uruchomienia.')
  const hide = await hideControllers(game.appId)
  try {
    if (game.shortcut) await openSteamUri(shortcutRunUri(game.shortcut.gameId64))
    else await openSteam('run', game.appId)
  } catch (e) {
    await showControllers() // Steam was not asked to run the game: controllers back right away
    throw e
  }
  launchedAppId = game.appId
  steamViaDeck = takeDeckLaunch(gameId)
  const steamRunning = library.current.steam.status === 'running'
  if (settings.get().afterLaunch === 'minimize' && !steamViaDeck) setTimeout(() => win?.minimize(), steamRunning ? 1500 : 4000)
  return { ok: true, message: (steamRunning ? 'Uruchamianie przez Steam…' : 'Uruchamianie Steam i gry…') + (hide ? ` ${hide}` : '') }
}

/**
 * Controllers hidden in the game's profile (the engine disables them in Windows: lumen_hide.py) —
 * back when Steam reports the game ended, or when it never starts. Returns a note for the player.
 */
async function hideControllers(appId: number | undefined): Promise<string> {
  // lumen_steam_begin itself brings back what the previous Steam game hid
  clearTimeout(hiddenWatchdog)
  hiddenForAppId = undefined
  if (!appId || engine.state !== 'ready') return ''
  if (DRY_RUN) {
    log.info('app', `DRY RUN, not hiding controllers for ${appId}`)
    return ''
  }
  // set before the call: if it times out, the engine may still have disabled devices — the game's end
  // (or the watchdog, or Lumen exiting) brings them back either way
  hiddenForAppId = appId
  // the game never started (download, error, closed dialog): devices back after 10 minutes
  hiddenWatchdog = setTimeout(() => {
    if (library.current.steam.runningAppId !== appId) void showControllers()
  }, 10 * 60_000)
  try {
    const r = await engine.call<{ hidden: string[]; note: string }>('lumen_steam_begin', [appId], 60_000)
    if (!r.hidden.length && hiddenForAppId === appId) {
      clearTimeout(hiddenWatchdog)
      hiddenForAppId = undefined
    }
    if (r.hidden.length) log.info('app', `controllers hidden for ${appId}: ${r.hidden.join(', ')}`)
    return [r.hidden.length ? `Ukryte na czas gry: ${r.hidden.join(', ')}.` : '', r.note].filter(Boolean).join(' ')
  } catch (e) {
    log.warn('app', `hiding controllers failed: ${(e as Error).message}`)
    return ''
  }
}

async function showControllers(): Promise<void> {
  clearTimeout(hiddenWatchdog)
  if (hiddenForAppId === undefined) return
  hiddenForAppId = undefined
  try {
    await engine.call('lumen_steam_end', [], 60_000)
  } catch (e) {
    log.warn('app', `restoring controllers failed: ${(e as Error).message}`)
  }
}

/** Ask the Steam client to install a game (Steam shows its own dialog and runs the download). */
async function installSteam(gameId: string): Promise<ActionResult> {
  const game = findGame(gameId)
  if (!game) return fail('Nie znaleziono gry w bibliotece.')
  if (game.source !== 'steam') return fail('Tej pozycji nie instaluje się przez Steam.')
  if (library.current.steam.status === 'notInstalled') return fail('Nie znaleziono klienta Steam na tym komputerze.')
  await openSteam('install', game.appId)
  return { ok: true, message: 'Steam otworzy okno instalacji — potwierdź tam lokalizację. Instalacją zarządza klient Steam.' }
}

async function openInSteam(gameId: string, view: 'details' | 'store' | 'downloads'): Promise<ActionResult> {
  const game = findGame(gameId)
  if (view === 'downloads') {
    await openSteam('downloads')
    return { ok: true }
  }
  if (!game || game.source !== 'steam') return fail('Ta pozycja nie jest grą ze sklepu Steam.')
  await openSteam(view, game.appId)
  return { ok: true }
}

// ---------------- IPC ----------------

function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => Promise<R> | R): void {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return await fn(...(args as A))
    } catch (e) {
      if (!(e instanceof PrefsError)) log.error('ipc', `${channel} failed`, e)
      throw new Error((e as Error).message)
    }
  })
}

async function updatePrefs(fn: (p: Prefs) => Prefs): Promise<Prefs> {
  const before = prefs.get().versions
  const overrides = prefs.get().platformOverrides
  const stamps = prefs.get().artStamps
  const p = await prefs.update(fn)
  if (p.artStamps !== stamps) scheduleArtSync()
  send(IPC.prefsChanged, p)
  scheduleDeckSync()
  if (p.versions !== before) emu.regroup()
  if (p.platformOverrides !== overrides) unified.update()
  return p
}

/** One way to change the settings (IPC and the Deck menu): save, then react to what changed and tell both windows. */
async function patchSettings(patch: SettingsPatch): Promise<Settings> {
  const before = settings.get()
  const after = await settings.patch(patch)
  // the order of art sources changed: Steam, GOG and EmuStart games ask again
  if (before.artPriority !== after.artPriority || before.sgdbFirstOff.join() !== after.sgdbFirstOff.join())
    for (const g of unified.current.games) bumpArt(g.id)
  if (before.demoMode !== after.demoMode || before.showTools !== after.showTools || before.steamIdOverride !== after.steamIdOverride) {
    await library.scan()
    if (before.steamIdOverride !== after.steamIdOverride) void library.refreshAccount(true)
  }
  if (before.regionOrder !== after.regionOrder) emu.regroup()
  if (before.gamepadBackend !== after.gamepadBackend) {
    // the Gamepad API backend registers the same Raw Input devices for Chromium
    if (after.gamepadBackend === 'xinput' && win && process.env.LUMEN_NO_PAD !== '1') hidPads.attach(win)
    else hidPads.detach()
  }
  if (before.emustartEnabled !== after.emustartEnabled || before.emustartHome !== after.emustartHome || before.pythonPath !== after.pythonPath) {
    if (after.emustartEnabled) void engine.restart()
    else void engine.stop()
  }
  if (before.deck.enabled !== after.deck.enabled || JSON.stringify(before.deck.screens) !== JSON.stringify(after.deck.screens) || before.deck.opacity !== after.deck.opacity)
    applyDeck()
  // the settings as they are now — a slower patch finishing after a newer one must not send older ones
  send(IPC.settingsChanged, settings.get())
  return after
}

function registerIpc(): void {
  handle(IPC.libraryGet, () => unified.current)
  handle(IPC.libraryRatings, async (ids: string[]) => {
    const ratings: Record<string, GameRatings> = {}
    const missing: number[] = []
    const lbIds = new Map<number, string[]>()
    for (const id of Array.isArray(ids) ? ids.slice(0, 20000) : []) {
      if (isEmuGameId(id)) {
        const lb = emuLbId(id)
        if (lb) lbIds.set(lb, [...(lbIds.get(lb) ?? []), id])
        continue
      }
      const appId = steamAppIdOf(id)
      if (!appId) continue
      const r = await meta.cachedRatings(appId)
      if (r) ratings[id] = { critic: r.critic, players: r.players }
      else if (!meta.wasTried(appId)) missing.push(appId) // tried this run without data: no rating
    }
    for (const [lb, r] of launchbox.ratingsById([...lbIds.keys()])) for (const id of lbIds.get(lb) ?? []) ratings[id] = { ...ratings[id], launchbox: r }
    if (missing.length) void meta.prefetch(missing)
    return { ratings, missing: missing.length }
  })
  // the list filters' data of PC games: Steam store cache, GOG descriptions from the server, LaunchBox
  const fromLaunchBox = (g: Game): GameFacts | undefined => {
    const hit = lbFacts.get(g.id)
    if (hit || !launchbox.ready) return hit
    const name = lbTitle(g.id, g.name)
    const d = g.source === 'gog' ? gogLaunchBox(name) : launchbox.details(name, g.shortcut ? platformForTags(g.shortcut.tags) : 'Windows')
    const f = d ? factsOf(d) : {}
    lbFacts.set(g.id, f)
    return f
  }
  handle(IPC.libraryFacts, async (ids: string[]) => {
    const facts: Record<string, GameFacts> = {}
    const missing: number[] = []
    let n = 0
    for (const id of Array.isArray(ids) ? ids.slice(0, 20000) : []) {
      if (isEmuGameId(id)) continue
      const g = findGame(id)
      if (!g) continue
      if (++n % 50 === 0) await new Promise((r) => setImmediate(r)) // the window stays responsive on a big library
      let f: GameFacts | undefined
      if (g.source === 'gog') {
        const i = gog.info(id)
        if (i?.tags?.length || i?.developers?.length || i?.release)
          f = { genres: i.tags?.length ? i.tags : undefined, developer: i.developers?.[0], year: /\b(19|20)\d{2}\b/.exec(i.release ?? '')?.[0] }
        const lb = fromLaunchBox(g)
        if (lb) f = { ...lb, ...Object.fromEntries(Object.entries(f ?? {}).filter(([, v]) => v !== undefined)) }
      } else {
        const appId = g.shortcut ? undefined : steamAppIdOf(id)
        if (appId) {
          const c = await meta.cachedFacts(appId)
          f = c?.facts
          if ((!c || !c.current) && !meta.wasTried(appId)) missing.push(appId)
        }
        if (!f?.genres?.length) f = { ...fromLaunchBox(g), ...f }
      }
      if (f) facts[id] = { ...f, genres: genresPl(f.genres) }
    }
    if (missing.length) void meta.prefetch(missing)
    return { facts, missing: missing.length }
  })
  handle(IPC.steamFamilyStatus, () => family.status)
  handle(IPC.steamFamilyLogin, () => family.login(win, library.current.steam.activeSteamId))
  handle(IPC.steamFamilyLogout, () => family.logout())
  handle(IPC.libraryRefresh, async (includeAccount: boolean) => {
    if (includeAccount) void family.refresh(library.current.steam.activeSteamId, true)
    if (includeAccount) await library.refreshAccount(true)
    await Promise.all([library.scan(), engine.state === 'ready' ? emu.refresh() : undefined])
    return unified.current
  })

  handle(IPC.gamePlay, (gameId: string) => playSteam(gameId))
  handle(IPC.gameInstall, (gameId: string) => installSteam(gameId))
  handle(IPC.gameOpen, (gameId: string, view: 'details' | 'store' | 'downloads') => openInSteam(gameId, view))

  handle(IPC.gameDetails, async (gameId: string, force?: boolean) => {
    const game = findGame(gameId)
    if (game?.emu) {
      if (engine.state !== 'ready')
        return withLaunchBox(gameId, { ok: false, error: engine.message ?? 'Silnik EmuStart nie działa — opis jest niedostępny.' })
      return withLaunchBox(gameId, emuDetails(await engine.call<Record<string, unknown>>('game_detail', [game.emu.id], 30_000)))
    }
    if (game?.gog) {
      // description from GOG Manager's game folder on the server, what it lacks (rating, players, age
      // rating…) from the LaunchBox database; without a GOG description — LaunchBox alone
      const info = gog.info(gameId)
      const st = await launchbox.status()
      const lb = st.ready ? gogLaunchBox(lbTitle(gameId, game.name)) : null
      if (info?.description || info?.lead) {
        const own: GameDetails = {
          appId: 0,
          fetchedAt: Date.now(),
          source: 'gog',
          name: game.name,
          shortDescription: info.lead || undefined,
          descriptionText: info.description || info.lead,
          genres: info.tags?.length ? info.tags : undefined,
          releaseDate: info.release || undefined,
          developers: info.developers?.length ? info.developers : undefined,
          publishers: info.publishers?.length ? info.publishers : undefined
        }
        return { ok: true, stale: false, details: lb ? { ...fillFromLaunchBox(own, lb), launchboxName: lb.name } : own }
      }
      if (!st.ready) return { ok: false, error: 'Opisy gier GOG wymagają bazy LaunchBox — pobierz ją w Ustawieniach.' }
      return lb ? { ok: true, details: lb, stale: false } : { ok: false, error: 'Nie znaleziono tej gry w bazie LaunchBox.' }
    }
    if (game?.shortcut) {
      const st = await launchbox.status()
      if (!st.ready) return { ok: false, error: 'Opisy gier spoza Steama wymagają bazy LaunchBox — pobierz ją w Ustawieniach.' }
      const d = launchbox.details(lbTitle(gameId, game.name), platformForTags(game.shortcut.tags))
      return d ? { ok: true, details: d, stale: false } : { ok: false, error: 'Nie znaleziono tej gry w bazie LaunchBox.' }
    }
    const appId = steamAppIdOf(gameId)
    if (!appId) return { ok: false, error: 'Brak danych dla pozycji demonstracyjnej.' }
    return meta.get(appId, force)
  })

  handle(IPC.launchboxStatus, () => launchbox.status())
  handle(IPC.launchboxUpdate, () => {
    void launchbox.update()
    return launchbox.status()
  })
  handle(IPC.launchboxCancel, () => launchbox.cancel())
  handle(IPC.launchboxTitle, async (gameId: string): Promise<LbTitleInfo> => {
    if (engine.state === 'ready') await syncLbTitles()
    return { name: prefs.get().lbTitles[String(gameId)] ?? '', admin: lbTitlesAdmin }
  })
  handle(IPC.launchboxSetTitle, async (gameId: string, name: string): Promise<ActionResult> => {
    const id = String(gameId)
    if (!/^(gog|shortcut):/.test(id)) return { ok: false, error: 'Nazwę w LaunchBox można ustawić grom GOG i skrótom spoza Steama.' }
    if (engine.state !== 'ready') return { ok: false, error: 'Silnik EmuStart nie działa — nazwy zapisuje serwer.' }
    const r = await engine
      .call<{ ok?: boolean; reason?: string; titles?: Record<string, string> }>('art_lb_title_set', [id, String(name ?? '').trim()], 30_000)
      .catch((e: Error) => ({ ok: false, reason: e.message, titles: undefined }))
    if (!r.ok || !r.titles) return { ok: false, error: r.reason || 'Serwer nie zapisał nazwy.' }
    lbTitlesRev++
    lbFacts.delete(id)
    const lbTitles = cleanLbTitles(r.titles)
    await updatePrefs((p) => ({ ...p, lbTitles }))
    return { ok: true, message: lbTitles[id] ? `Nazwa w LaunchBox: ${lbTitles[id]}` : 'Nazwa ręczna usunięta' }
  })

  handle(IPC.prefsGet, () => prefs.get())
  handle(IPC.prefsOp, async (op: string, ...args: unknown[]) => {
    switch (op) {
      case 'toggleFavorite':
        return updatePrefs((p) => ops.toggleFavorite(p, args[0] as string))
      case 'setGameCategories':
        return updatePrefs((p) => ops.setGameCategories(p, args[0] as string, args[1] as string[]))
      case 'createCategory':
        return updatePrefs((p) => ops.createCategory(p, args[0] as string))
      case 'renameCategory':
        return updatePrefs((p) => ops.renameCategory(p, args[0] as string, args[1] as string))
      case 'deleteCategory':
        return updatePrefs((p) => ops.deleteCategory(p, args[0] as string))
      case 'setPinned':
        return updatePrefs((p) => ops.setPinned(p, args[0] as string, args[1] as boolean))
      case 'moveCategory':
        return updatePrefs((p) => ops.moveCategory(p, args[0] as string, args[1] as number))
      case 'setPlatformOverride':
        return updatePrefs((p) => ops.setPlatformOverride(p, String(args[0]), typeof args[1] === 'string' ? args[1] : undefined))
      case 'setGroupPinned':
        return updatePrefs((p) => ops.setGroupPinned(p, String(args[0]), args[1] === true))
      case 'moveGroupPin':
        return updatePrefs((p) => ops.moveGroupPin(p, String(args[0]), Number(args[1]) || 0))
      default:
        throw new Error(`Unknown prefs op ${op}`)
    }
  })

  handle(IPC.settingsGet, () => settings.get())
  handle(IPC.settingsPatch, (patch: SettingsPatch) => patchSettings(patch))
  handle(IPC.settingsSecret, async (name: SecretName, value: string | null) => {
    if (!['sgdbApiKey', 'steamWebApiKey', 'igdbClientId', 'igdbClientSecret', 'tgdbApiKey'].includes(name)) throw new Error('Unknown secret')
    await settings.setSecret(name, value)
    if (name === 'steamWebApiKey') void library.refreshAccount(true)
    if (name === 'sgdbApiKey') {
      // previous "not found" results may have been caused by a missing key
      for (const g of library.current.games) bumpArt(g.id)
    }
    send(IPC.settingsChanged, settings.get())
    return settings.get()
  })

  handle(IPC.artOptions, async (gameId: string, kind: ArtKind, pageArg?: number) => {
    if (!sgdb.enabled) return { ok: false, error: 'Dodaj klucz SteamGridDB w Ustawieniach, aby przeglądać grafiki.' }
    const appId = steamAppIdOf(gameId)
    const manual = prefs.get().art[gameId]
    const page = Math.max(0, Math.floor(Number(pageArg) || 0))
    // the "Grafiki" window: animated images too, one page at a time ("Pokaż więcej")
    const opts = { animated: true, page }
    const result = (sgdbGame: SgdbGame | undefined, options: ArtOption[]): ArtOptionsResult => ({
      ok: true,
      sgdbGame,
      options,
      page,
      hasMore: options.length >= SGDB_PAGE_SIZE
    })
    try {
      if (manual?.sgdbGameId) {
        return result(
          { id: manual.sgdbGameId, name: manual.sgdbGameName ?? `#${manual.sgdbGameId}` },
          await sgdb.images(kind, { gameId: manual.sgdbGameId }, opts)
        )
      }
      if (isEmuGameId(gameId)) {
        // EmuStart: exact title match, like the automatic poster (correct it with "Zmień dopasowanie")
        const names = emuTitles(gameId)
        let match: SgdbGame | undefined
        for (const n of names.slice(0, 3)) if ((match = pickExactMatch(names, await sgdb.search(n)))) break
        return result(match, match ? await sgdb.images(kind, { gameId: match.id }, opts) : [])
      }
      if (!appId) {
        // non-Steam shortcut: match by title (the user can correct it with "Zmień dopasowanie")
        const name = findGame(gameId)?.name
        const match = name ? pickBestMatch(name, await sgdb.search(name)) : undefined
        return result(match, match ? await sgdb.images(kind, { gameId: match.id }, opts) : [])
      }
      const [game, options] = await Promise.all([page ? Promise.resolve(undefined) : sgdb.gameBySteamId(appId), sgdb.images(kind, { steamAppId: appId }, opts)])
      return result(game, options)
    } catch (e) {
      return { ok: false, error: e instanceof SgdbAuthError ? e.message : 'Nie udało się połączyć ze SteamGridDB.' }
    }
  })
  handle(IPC.artLbOptions, async (gameId: string, kind: ArtKind) => {
    if (!isEmuGameId(gameId)) return { ok: false, error: 'Grafiki LaunchBox są dostępne dla gier EmuStart.' }
    if (!emuLbId(gameId)) return { ok: false, error: 'Serwer EmuStart nie przypisał tej grze pozycji w LaunchBox.' }
    const st = await launchbox.status()
    if (!st.ready) return { ok: false, error: 'Pobierz bazę LaunchBox w Ustawieniach (Opisy gier spoza Steama).' }
    if (st.outdated || st.job) return { ok: false, error: 'Baza LaunchBox aktualizuje się (dochodzi lista grafik) — spróbuj za kilka minut.' }
    return { ok: true, options: emuLbImages(gameId, PICKER_TYPES[kind] ?? []).slice(0, 48) }
  })
  handle(IPC.artChooseLb, async (gameId: string, kind: ArtKind, url: string, layout?: ArtLayout) => {
    if (!ART_KINDS.includes(kind)) throw new Error('Nieznany rodzaj grafiki.')
    if (!String(url).startsWith(IMAGE_BASE)) throw new Error('Nieoczekiwany adres grafiki.')
    const p = await updatePrefs((pr) => ops.setArt(pr, gameId, kind, { type: 'launchbox', url: String(url) }, layoutOf(layout)))
    bumpArt(gameId, kind)
    return p
  })
  handle(IPC.artSearch, async (term: string) => {
    if (!sgdb.enabled) return { ok: false, error: 'Brak klucza SteamGridDB.' }
    try {
      return { ok: true, games: await sgdb.search(term) }
    } catch (e) {
      return { ok: false, error: e instanceof SgdbAuthError ? e.message : 'Wyszukiwanie w SteamGridDB nie powiodło się.' }
    }
  })
  handle(IPC.artSetMatch, async (gameId: string, g: SgdbGame | null) => {
    const p = await updatePrefs((pr) => ops.setSgdbMatch(pr, gameId, g?.id, g?.name))
    bumpArt(gameId)
    return p
  })
  handle(IPC.artChoose, async (gameId: string, kind: ArtKind, o: ArtOption, layout?: ArtLayout) => {
    if (!/^https:\/\/cdn2\.steamgriddb\.com\//.test(o.url)) throw new Error('Nieoczekiwany adres grafiki.')
    const p = await updatePrefs((pr) => ops.setArt(pr, gameId, kind, { type: 'sgdb', imageId: o.id, url: o.url, thumb: o.thumb }, layoutOf(layout)))
    bumpArt(gameId, kind)
    return p
  })
  handle(IPC.artUserGallery, async (gameId: string, kind: ArtKind) => {
    if (engine.state !== 'ready') return { ok: false, error: 'Silnik EmuStart jeszcze się uruchamia.' }
    const r = await engine.call<{ items?: UserArtItem[]; reason?: string }>('art_user_gallery', [String(gameId), kind], 30_000).catch(() => null)
    return r?.items ? { ok: true, items: r.items } : { ok: false, error: r?.reason || 'Serwer EmuStart nie odpowiada.' }
  })
  const KEY_SECRETS: [string, SecretName][] = [
    ['sgdb_key', 'sgdbApiKey'],
    ['igdb_client_id', 'igdbClientId'],
    ['igdb_client_secret', 'igdbClientSecret'],
    ['tgdb_key', 'tgdbApiKey']
  ]
  handle(IPC.artKeysImport, async (file: string | null, password: string) => {
    if (engine.state !== 'ready') throw new Error('Silnik EmuStart jeszcze się uruchamia.')
    const r = await engine.call<{ ok: boolean; reason?: string; keys?: Record<string, string> }>(
      file ? 'art_keys_open' : 'art_keys_pylinks',
      file ? [String(file), String(password)] : [],
      60_000
    )
    if (!r.ok || !r.keys) throw new Error(r.reason || 'Nie udało się odczytać kluczy.')
    for (const [from, to] of KEY_SECRETS) if (r.keys[from]) await settings.setSecret(to, r.keys[from])
    for (const g of library.current.games) bumpArt(g.id)
    send(IPC.settingsChanged, settings.get())
    return settings.get()
  })
  handle(IPC.artKeysExport, async (folder: string, password: string) => {
    if (engine.state !== 'ready') throw new Error('Silnik EmuStart jeszcze się uruchamia.')
    const plain = Object.fromEntries(KEY_SECRETS.map(([from, to]) => [from, settings.getSecret(to) ?? '']))
    const r = await engine.call<{ ok: boolean; reason?: string; file?: string }>('art_keys_export', [String(folder), String(password), plain], 60_000)
    if (!r.ok || !r.file) throw new Error(r.reason || 'Nie udało się zapisać pliku.')
    return r.file
  })
  // the user's own IGDB / TheGamesDB keys: asked from this device, never through the EmuStart server
  handle(IPC.artOwnOptions, async (gameId: string, kind: ArtKind) => {
    const keys = {
      igdb_client_id: settings.getSecret('igdbClientId') ?? '',
      igdb_client_secret: settings.getSecret('igdbClientSecret') ?? '',
      tgdb_key: settings.getSecret('tgdbApiKey') ?? ''
    }
    if (!keys.tgdb_key && !(keys.igdb_client_id && keys.igdb_client_secret)) return { ok: false, error: 'Dodaj własny klucz IGDB albo TheGamesDB w Ustawieniach.' }
    const sk = kind === 'grid' ? 'box' : kind === 'hero' ? 'snap' : kind === 'logo' ? 'logo' : ''
    if (!sk) return { ok: true, options: [] }
    if (engine.state !== 'ready') return { ok: false, error: 'Silnik EmuStart jeszcze się uruchamia.' }
    const r = await engine
      .call<{ options?: { url: string; source: string }[]; error?: string }>('art_own_candidates', [emu.engineId(gameId) ?? 0, findGame(gameId)?.name ?? '', sk, keys], 45_000)
      .catch(() => null)
    return r?.options ? { ok: true, options: r.options, error: r.error || undefined } : { ok: false, error: 'Nie udało się zapytać IGDB / TheGamesDB.' }
  })
  handle(IPC.artChooseOwn, async (gameId: string, kind: ArtKind, url: string, layout?: ArtLayout) => {
    if (!ART_KINDS.includes(kind)) throw new Error('Nieznany rodzaj grafiki.')
    if (!WEB_ART.test(String(url))) throw new Error('Nieoczekiwany adres grafiki.')
    const p = await updatePrefs((pr) => ops.setArt(pr, gameId, kind, { type: 'web', url: String(url) }, layoutOf(layout)))
    bumpArt(gameId, kind)
    return p
  })
  handle(IPC.artChooseUser, async (gameId: string, kind: ArtKind, sha: string, ext: string, layout?: ArtLayout) => {
    if (!ART_KINDS.includes(kind) || !/^[0-9a-f]{64}$/.test(String(sha)) || !/^(png|jpg|webp|gif)$/.test(String(ext))) throw new Error('Zła grafika.')
    const p = await updatePrefs((pr) => ops.setArt(pr, gameId, kind, { type: 'user', sha, ext }, layoutOf(layout)))
    bumpArt(gameId, kind)
    return p
  })
  handle(IPC.artUseFile, async (gameId: string, kind: ArtKind, src: string, layout?: ArtLayout) => {
    const lay = layoutOf(layout)
    const choices = lay === 'tv' ? prefs.get().artTv : prefs.get().art
    if (!ART_KINDS.includes(kind)) throw new Error('Nieznany rodzaj grafiki.')
    if (!/\.(png|jpe?g|webp|gif)$/i.test(String(src))) throw new Error('Wybierz plik PNG, JPG, WebP albo GIF.')
    const stat = await fs.stat(src).catch(() => null)
    if (!stat?.isFile()) throw new Error('Wybrany plik nie istnieje.')
    if (stat.size > 25 * 1024 * 1024) throw new Error('Plik jest zbyt duży (maks. 25 MB).')
    await fs.mkdir(paths.customArt, { recursive: true })
    const safe = gameId.replace(/[^a-zA-Z0-9_-]/g, '_')
    const dest = path.join(paths.customArt, `${safe}-${lay === 'tv' ? 'tv-' : ''}${kind}-${Date.now()}${path.extname(src).toLowerCase()}`)
    await fs.copyFile(src, dest)
    const old = choices[gameId]?.[kind]
    const p = await updatePrefs((pr) => ops.setArt(pr, gameId, kind, { type: 'file', file: dest }, lay))
    if (old?.type === 'file' && old.file.startsWith(paths.customArt)) await fs.rm(old.file, { force: true })
    bumpArt(gameId, kind)
    return p
  })
  handle(IPC.artUseSteam, async (gameId: string, kind: ArtKind, layout?: ArtLayout) => {
    const p = await updatePrefs((pr) => ops.setArt(pr, gameId, kind, { type: 'steam' }, layoutOf(layout)))
    bumpArt(gameId, kind)
    return p
  })
  handle(IPC.artReset, async (gameId: string, kind: ArtKind, layout?: ArtLayout) => {
    const lay = layoutOf(layout)
    const old = (lay === 'tv' ? prefs.get().artTv : prefs.get().art)[gameId]?.[kind]
    const p = await updatePrefs((pr) => ops.setArt(pr, gameId, kind, undefined, lay))
    if (old?.type === 'file' && old.file.startsWith(paths.customArt)) await fs.rm(old.file, { force: true })
    bumpArt(gameId, kind)
    return p
  })

  handle(IPC.appFullscreen, () => {
    if (!win) return false
    win.setFullScreen(!win.isFullScreen())
    return win.isFullScreen()
  })
  handle(IPC.appIsFullscreen, () => !!win?.isFullScreen())
  handle(IPC.appCacheStats, () => artwork.stats())
  handle(IPC.appClearCache, async () => {
    await artwork.clear()
    await fs.rm(paths.metaCache, { recursive: true, force: true })
    for (const g of library.current.games) bumpArt(g.id)
    return artwork.stats()
  })
  handle(IPC.appOpenLogs, async () => {
    shell.showItemInFolder(logFile)
  })
  handle(IPC.appOpenExternal, async (url: string) => {
    if (!/^https:\/\//.test(url)) throw new Error('Dozwolone są tylko adresy https.')
    await shell.openExternal(url)
  })
  handle(IPC.appQuit, () => app.quit())
  // TV menu → Wyjdź z Lumen → Schowaj do zasobnika: like closing the window with the Deck on (it keeps running)
  handle(IPC.appHide, () => {
    if (!settings.get().deck.enabled || !deck?.window || !win || win.isDestroyed()) return false
    win.hide()
    log.info('window', 'hidden to the tray (TV menu)')
    return true
  })
  handle(IPC.appListDir, (dir: string, o: FsListOptions) =>
    listDir(String(dir ?? ''), { kind: o?.kind === 'file' ? 'file' : 'folder', extensions: Array.isArray(o?.extensions) ? o.extensions : undefined }, places())
  )

  registerGogIpc(handle, {
    engine,
    gog,
    settings: () => settings.get(),
    // a GOG game started: minimize like Steam games and come back when it ends
    launched: (gameId) => {
      launchedGog = gameId
      gogViaDeck = takeDeckLaunch(gameId)
      if (settings.get().afterLaunch === 'minimize' && !gogViaDeck) setTimeout(() => win?.minimize(), 1500)
    }
  })

  registerEmustartIpc(handle, {
    engine,
    provider: emu,
    win: () => win,
    jobs: () => unified.jobs,
    dataDir: () => settings.get().emustartHome || paths.emustartHome,
    changed: () => void emu.refresh(),
    artChanged: (gameId) => {
      emuArtCache.clear()
      emuArtBytes = 0
      bumpArt(gameId)
    },
    engineImage: async (url) => {
      // engine media and server previews through the engine; art sources' previews (https) directly
      const external = /^https:\/\//.test(url)
      if (!external && (!engine.baseUrl || !/^\/(media|serwer)\//.test(url))) return undefined
      try {
        const res = await fetch(external ? url : new URL(url, engine.baseUrl!), { signal: AbortSignal.timeout(15_000) })
        if (external && !(res.headers.get('content-type') ?? '').startsWith('image/')) return undefined
        if (!res.ok) return undefined
        return `data:${res.headers.get('content-type') ?? 'image/png'};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`
      } catch {
        return undefined
      }
    }
  })

  handle(IPC.emuChooseVersion, async (gameId: string, versionId: string | null) => {
    const versions = emu.versionsOf(String(gameId))
    if (!versions.length) throw new Error('Ta gra ma jedną wersję.')
    if (versionId !== null && !versions.some((v) => v.id === versionId)) throw new Error('Nieznana wersja gry.')
    return updatePrefs((p) => ops.chooseVersion(p, gameId, versionId ?? undefined))
  })

  handle(IPC.updateGet, () => updater.state)
  handle(IPC.updateCheck, () => updater.check())
  handle(IPC.updateDownload, () => {
    void updater.download()
    return updater.state
  })
  handle(IPC.updateCancel, () => updater.cancel())
  handle(IPC.updateApply, () => updater.apply())

  handle(IPC.uiGetMode, () => modes?.mode ?? 'desktop')
  handle(IPC.uiSetMode, (mode: UiMode) => modes?.setMode(mode === 'fullscreen' ? 'fullscreen' : 'desktop'))
  ipcMain.on(IPC.deckMenu, () => deck?.popupMenu())
  // a Deck tile double-clicked: the main window runs the game's main action (lib/deckPlay.ts)
  ipcMain.on(IPC.deckPlay, (_e, gameId: unknown) => {
    if (typeof gameId !== 'string' || !win || win.isDestroyed()) return
    deckLaunch = { gameId, at: Date.now(), mainHidden: !win.isVisible(), seenActive: false }
    log.info('deck', `play ${gameId}`)
    win.webContents.send(IPC.deckPlayRequest, gameId)
  })
  // the player has to answer something (the game cannot start, a save conflict…): the window, and it stays
  ipcMain.on(IPC.deckReveal, () => {
    if (deckLaunch) deckLaunch.mainHidden = false
    restoreWindow()
  })
  ipcMain.on(IPC.deckExpand, (_e, content: unknown) => deck?.expand(typeof content === 'number' ? content : null))
  handle(IPC.deckGetGeometry, () => deck?.geometry ?? null)
  handle(IPC.deckAutostart, () => getAutostart())
  handle(IPC.deckSetAutostart, (on: unknown) => {
    if (!setAutostart(on === true)) throw new Error('Windows nie pozwolił zapisać autostartu (zasady systemu albo program zabezpieczający).')
  })
  // Deck's dimensions are kept per screen: the screen it is on now (the primary one)
  handle(IPC.deckScreen, () => deckScreen())
  handle(IPC.deckLayout, async (step: DeckLayoutStep) => {
    // only the two widths, by a small step, on a screen key the settings accept
    const field = step?.field === 'panelWidth' ? 'panelWidth' : step?.field === 'dockWidth' ? 'dockWidth' : null
    const delta = typeof step?.delta === 'number' && Number.isFinite(step.delta) ? Math.max(-0.1, Math.min(0.1, step.delta)) : 0
    if (!field || !delta || typeof step.key !== 'string' || typeof step.label !== 'string') return
    await patchSettings({ deck: { screens: setDeckLayout(settings.get().deck, { key: step.key, label: step.label.slice(0, 40), field, delta }) } })
  })
  // a tab changed in Settings — applied here, to the stored tabs (one writer), never a renderer's copy
  handle(IPC.deckGroup, async (op: DeckGroupOp) => {
    const cur = settings.get().deck
    const groups = moveDeckGroup(syncGroups(cur.groups, currentDeckCandidates()), op)
    if (groups !== cur.groups) await patchSettings({ deck: { groups } })
  })
  ipcMain.on(IPC.uiSelect, (_e, gameId: unknown) => modes?.select(typeof gameId === 'string' ? gameId : null))
}

/**
 * Lumen's own EmuStart folder: emulators (and with them the BIOS files from the server, which go
 * to RetroArch's system folder) live inside it unless the user chose another folder. An existing
 * EmuStart folder picked in Settings keeps its own configuration.
 */
async function emustartDefaults(): Promise<void> {
  if (settings.get().emustartHome) return
  try {
    const s = await engine.call<{ emu_root?: string }>('get_settings', [], 30_000)
    if (s.emu_root) return
    const root = path.join(paths.emustartHome, 'emulators')
    await fs.mkdir(root, { recursive: true })
    await engine.call('save_settings', [{ emu_root: root }], 30_000)
    log.info('emustart', `folder emulatorów: ${root}`)
    void emu.refresh()
  } catch (e) {
    log.warn('emustart', `domyślny folder emulatorów: ${(e as Error).message}`)
  }
}

// ---------------- lifecycle ----------------

app.on('second-instance', () => restoreWindow())

let started = false // set once the app is ready: a second instance quitting at once has nothing to stop
app.whenReady().then(async () => {
  log.info('app', `Lumen ${app.getVersion()} starting (electron ${process.versions.electron}, packaged=${app.isPackaged})`)
  log.info('app', `data folder: ${userData}`)
  if (dataChoice.warning) log.warn('app', dataChoice.warning)
  if (migrated.length) log.info('app', `copied from ${legacyDataDir} (left unchanged): ${migrated.join(', ')}`)
  await Promise.all([settings.init(), prefs.init(), emu.init(), gog.init(), family.init()])
  family.on('change', () => library.setFamily(family.games(library.current.steam.activeSteamId)))
  platformCatalog = await platformsFile.load()
  started = true
  registerArtProtocol()
  registerIpc()

  launchbox.on('changed', () => void launchbox.status().then((st) => send(IPC.launchboxChanged, st)))
  unified.on('snapshot', (s: LibrarySnapshot) => {
    send(IPC.librarySnapshot, s)
    scheduleDeckSync()
    // EmuStart platforms as group tabs — only from a live engine library, never from an empty one
    const systems = s.emustart.systems
    if (s.emustart.engine === 'ready' && !s.emustart.fromCache && systems.length && ops.syncEmustartSystems(prefs.get(), systems) !== prefs.get()) {
      updatePrefs((p) => ops.syncEmustartSystems(p, systems)).catch((e) => log.error('prefs', 'platform sync failed', e))
    }
  })
  unified.on('jobs', (j: JobsSnapshot) => {
    send(IPC.jobsChanged, j)
    followDeckLaunch(j)
  })
  updater.on('state', (s) => send(IPC.updateChanged, s))
  // like EmuStart: look for a new version shortly after start and once a day
  const autoCheck = (): void => void updater.check()
  setTimeout(autoCheck, 20_000)
  setInterval(autoCheck, 24 * 3600_000)
  engine.on('event', (ev: { type: string }) => {
    if (ev.type === 'quit') app.quit()
  })
  setInterval(() => scheduleArtSync(0), 10 * 60_000)
  engine.on('state', (st) => {
    engineReadyAt = st === 'ready' ? Date.now() : 0
    if (st === 'ready') scheduleArtSync(8000)
    if (st !== 'ready') return
    void emustartDefaults()
    // EmuStart's system catalog (families, names, plat codes) — classifies Steam shortcuts by their tags
    void engine
      .call<PlatformInfo[]>('platform_catalog', [], 20_000)
      .then(async (cat) => {
        if (!Array.isArray(cat) || !cat.length) return
        platformCatalog = cat
        await platformsFile.save(cat)
        unified.update()
      })
      .catch((e) => log.warn('emustart', `platform catalog: ${(e as Error).message}`))
  })
  gog.on('status', (st: { running: string[] }) => {
    // the GOG game started from Lumen ended (its process tree is gone): back to Lumen, like Steam games
    if (launchedGog && !st.running.includes(launchedGog.slice(4))) {
      log.info('app', `GOG game ${launchedGog} ended`)
      launchedGog = undefined
      if (settings.get().restoreAfterGame && !gogViaDeck) restoreWindow()
      gogViaDeck = false
    }
  })
  gog.on('message', (m: { gameId: string; ok: boolean; message: string }) => {
    const g = unified.game(m.gameId)
    send(IPC.gogMessage, { ...m, title: g?.name ?? '' })
  })
  library.on('snapshot', (s: LibrarySnapshot) => {
    // mirror Steam collections as read-only categories (skipped when they could not be read,
    // so a missing file never wipes the user's pins)
    if (s.collections && prefs.get() !== ops.syncSteamCollections(prefs.get(), s.collections)) {
      updatePrefs((p) => ops.syncSteamCollections(p, s.collections!)).catch((e) => log.error('prefs', 'collection sync failed', e))
    }
  })
  library.on('gameStarted', (appId: number) => log.info('app', `game ${appId} started (per Steam registry)`))
  library.on('gameExited', (appId: number) => {
    log.info('app', `game ${appId} exited (per Steam registry)`)
    if (launchedAppId === appId && settings.get().restoreAfterGame && !steamViaDeck) restoreWindow()
    if (launchedAppId === appId) steamViaDeck = false
    launchedAppId = undefined
    if (hiddenForAppId === appId) void showControllers()
  })
  createWindow()
  deck = new DeckWindow({
    preload: path.join(__dirname, '../preload/index.js'),
    load: loadDeckPage,
    deck: () => settings.get().deck,
    openMain: () => restoreWindow(),
    // the Deck window is gone without the player switching it off — with the main window hidden nothing
    // would be left on screen
    lost: () => {
      if (win && !win.isDestroyed() && !win.isVisible()) restoreWindow()
    },
    disable: () => void patchSettings({ deck: { enabled: false } }).catch((e) => log.error('deck', 'switching off failed', e)),
    quit: () => app.quit(),
    geometry: (w, g) => w.webContents.send(IPC.deckGeometry, g),
    autostart: getAutostart,
    setAutostart,
    // the built program's own icon (Lumen.exe); from sources the icon file the build uses
    // ('normal' = 32 px: the tray scales it down — a 16 px one is blurry with display scaling)
    icon: () => (app.isPackaged ? app.getFileIcon(process.execPath, { size: 'normal' }) : Promise.resolve(nativeImage.createFromPath(path.join(app.getAppPath(), 'resources', 'icon.png'))))
  })
  deck.sync()
  if (app.isPackaged) refreshAutostartPath()
  // controller: passive XInput polling, only while Lumen has focus (never while a game runs)
  settings.setRuntimeInfo({ xinputAvailable: pads.available })
  // pads that are not XInput devices (PlayStation, Nintendo, Bluetooth HID): passive Raw Input on the same window
  if (win && process.env.LUMEN_NO_PAD !== '1' && settings.get().gamepadBackend === 'xinput') hidPads.attach(win)
  let combo = false
  pads.start(
    () =>
      // LUMEN_NO_PAD=1: automated UI tests ignore controllers connected to this PC
      process.env.LUMEN_NO_PAD !== '1' &&
      settings.get().gamepadBackend === 'xinput' &&
      !!win &&
      !win.isDestroyed() &&
      !win.isMinimized() &&
      (win.isFocused() || padWithoutFocus()),
    (state) => {
      // focus taken by something invisible (Lumen still on top): the pad brings it back
      if (win && !win.isDestroyed() && !win.isFocused() && state.some((p) => p.buttons || Math.abs(p.lx) > 16000 || Math.abs(p.ly) > 16000))
        refocus()
      // View + Start: switch between the desktop and fullscreen interfaces
      const nowCombo = state.some(isModeCombo)
      if (nowCombo && !combo) modes?.toggle()
      combo = nowCombo
      if (nowCombo) return
      send(IPC.padState, state)
    }
  )
  library
    .start()
    .then(() => {
      library.setFamily(family.games(library.current.steam.activeSteamId))   // the last known list at once
      void family.refresh(library.current.steam.activeSteamId)
    })
    .catch((e) => log.error('library', 'start failed', e))
  // a LaunchBox database from an older Lumen has no image list (posters, backgrounds) — rebuilt once
  setTimeout(() => void launchbox.upgradeIfOutdated().catch((e) => log.warn('launchbox', `upgrade: ${(e as Error).message}`)), 30_000)
  if (settings.get().emustartEnabled) engine.start().catch((e) => log.error('engine', 'start failed', e))
})

app.on('window-all-closed', () => app.quit())

// Every way out (window closed, "Wyjdź z Lumen", the engine's quit event) passes here — app.quit()
// does not emit window-all-closed. Stop polling, save the art cache index, and let the engine finish
// (save uploads after the last game) before Lumen exits.
let shutDown = false
app.on('before-quit', (e) => {
  if (shutDown || !started) return
  e.preventDefault()
  shutDown = true
  void shutdown().finally(() => app.quit())
})

async function shutdown(): Promise<void> {
  // the Deck and its tray icon go first: their menu must not reopen the window halfway through quitting
  deck?.close()
  localMedia.close()
  await showControllers() // never leave a wheel disabled after Lumen exits
  library.stop()
  emu.stop()
  await artwork.flush()
  if (engine.state !== 'disabled' && engine.state !== 'missing') await engine.stop()
}

process.on('unhandledRejection', (e) => log.error('app', 'unhandled rejection', e))
