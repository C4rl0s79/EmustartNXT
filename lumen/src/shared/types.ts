// Types shared between the main process, preload bridge and renderer.
// Game identity is always the stable `id` ("steam:<appid>"), never the title.

import type { DeckSettings } from './deck'

/**
 * steam = Steam app; shortcut = non-Steam game added to Steam (shortcuts.vdf); demo = fake data;
 * emustart = game on the EmuStart server, downloaded and run with an emulator by the EmuStart engine;
 * gog = GOG game from the EmuStart server's depot archive, installed and run by the EmuStart engine
 */
export type GameSource = 'steam' | 'shortcut' | 'demo' | 'emustart' | 'gog'

/**
 * Platform family for navigation — independent of the source (a Steam shortcut can run an emulator,
 * a GOG game is a PC game). other = unrecognised platform ("Pozostałe" — shown, never hidden).
 */
export type PlatformFamily = 'pc' | 'computer' | 'console' | 'arcade' | 'other'

/** Where a game sits in the library hierarchy (computed from the source, the platform catalog and manual choices). */
export interface GamePlatform {
  family: PlatformFamily
  /** subgroup: steam | gog | shortcut (PC), emu:<es> (an emulated platform), other:… */
  id: string
  label: string
  /** set by the player for an ambiguous Steam shortcut */
  manual?: boolean
}

/** A known emulated platform (EmuStart's system catalog: platform_catalog) */
export interface PlatformInfo {
  es: string
  display: string
  plat: string
  family: PlatformFamily
}

/** Install state derived from Steam's appmanifest StateFlags (see main/steam/manifests.ts). */
export type InstallState =
  | 'installed'
  | 'notInstalled'
  | 'updateRequired'
  | 'updating' // update/download in progress
  | 'updatePaused'
  | 'installing' // first-time download in progress
  | 'uninstalling'
  | 'broken' // files missing/corrupt, needs validation in Steam

export interface DownloadProgress {
  /** Raw byte counters written by Steam into the manifest. They are refreshed by Steam with a delay. */
  bytesDownloaded: number
  bytesToDownload: number
  bytesStaged: number
  bytesToStage: number
}

/** Where we learned about this game. Local-only detection is NOT the full owned library. */
export type Provenance = 'familyShared' | 'localManifest' | 'accountApi' | 'steamShortcut' | 'demo' | 'emustartServer' | 'emustartGog'

export interface Game {
  id: string
  source: GameSource
  appId: number
  name: string
  sortName: string
  provenance: Provenance[]
  /** lent by the Steam family group (not owned by this account) */
  familyShared?: boolean
  installState: InstallState
  installed: boolean
  installDir?: string
  libraryPath?: string
  sizeOnDisk?: number
  buildId?: string
  progress?: DownloadProgress
  /** unix seconds; from local Steam config or the Web API */
  lastPlayed?: number
  /** unix seconds; when the game appeared on this PC (install manifest / ROM file creation) */
  addedAt?: number
  /** minutes */
  playtimeMinutes?: number
  running?: boolean
  /** only for non-Steam shortcuts */
  shortcut?: {
    exe: string
    launchOptions?: string
    /** Steam tags set on the shortcut, e.g. "PS2" (the generic "Non-Steam" tag is dropped) */
    tags: string[]
    /** id for steam://rungameid */
    gameId64: string
  }
  /** only for EmuStart games (source 'emustart') */
  emu?: EmuGameInfo
  /** only for GOG games (source 'gog') */
  gog?: GogGameInfo
  /** PC games: genre, developer, year, players for the filters (renderer: tv/facts.ts) */
  facts?: GameFacts
  /** family and platform in the library hierarchy (set by the main process for every game) */
  platform?: GamePlatform
}

/** Install state of a GOG game in the EmuStart engine's local registry (emustart/goginstall.py). */
export type GogInstallState = 'notInstalled' | 'installing' | 'installed' | 'needs_admin' | 'failed' | 'cancelled' | 'damaged'

/** GOG-specific part of a game. Game.id = gog:<productId> — never a Steam appId. */
/** bonus content of a GOG game on the EmuStart server */
export interface GogExtra {
  id: string
  name: string
  type: string
  size: number
  /** pre-selected (old versions, language patches and multi-part packs are not) */
  default: boolean
  have?: boolean
}

export interface SteamFamilyStatus {
  loggedIn: boolean
  count: number
  fetchedAt: number
  error?: string
}

export interface GogGameInfo {
  productId: string
  extras?: GogExtra[]
  state: GogInstallState
  /** the server has a complete build of this game now (or had, in the offline copy) */
  onServer: boolean
  /** newest build on the server */
  available?: { buildId: string; version: string; languages: string[]; dlcs: { id: string; name: string; hasFiles: boolean }[]; size: number }
  /** installed build (registry) */
  buildId?: string
  version?: string
  installDir?: string
  languages?: string[]
  primary?: string
  dlcs?: string[]
  error?: string
  /** HKLM registry steps waiting for administrator approval */
  adminSteps?: number
  /** system libraries (Visual C++, DirectX) shipped as dependencies, and whether they were run */
  runtimes?: { id: string; done: boolean }[]
  /** kroki instalatora gry, których Lumen nie wykonał (np. Eksplorator gier Windows, ścieżka deinstalatora Inno) */
  skipped?: string[]
  /** kroki administratora pominięte po 3 nieudanych próbach (np. biblioteka, wpis zgodności) */
  adminFailed?: number
  pendingDlc?: string[]
  /** the server has a different build than the installed one (updating is not supported yet) */
  updateNote?: string
}

/** EmuStart-specific part of a game. `id` is the engine's local number (changes per device);
 *  Game.id uses the stable `sid` (same on every device: system + game name on the server). */
export interface EmuGameInfo {
  id: number
  sid: string
  es: string
  system: string
  tags: string
  size: number
  /** complete copy in the local game cache — playable without the server */
  cached: boolean
  /** kept locally on purpose (outside the "last N games" cache limit) */
  pinned: boolean
  /** a download of this game is in progress */
  copying: boolean
  /** discs in the set (multi-disc games are one entry); 1 = single disc / cartridge */
  discs: number
  /** LaunchBox Games DB id (server metadata) — releases of one game share it */
  lb?: number
  /** regional versions / revisions of this game (desktop shows them as one entry); absent = one version */
  versions?: EmuVersion[]
  /** id (emu:<sid>) of the version this entry shows and plays */
  shownVersion?: string
  genre?: string
  year?: string
  players?: string
  developer?: string
  publisher?: string
  hasBox: boolean
  hasSnap: boolean
  hasLogo: boolean
}

export type SteamClientStatus = 'running' | 'notRunning' | 'notInstalled' | 'unknown'

export interface SteamUser {
  steamId64: string
  accountName?: string
  mostRecent: boolean
}

export type AccountLibraryStatus =
  | { state: 'disabled'; reason: 'noKey' | 'noSteamId' }
  | { state: 'ok'; count: number; fetchedAt: number; fromCache: boolean }
  | { state: 'private'; fetchedAt: number }
  | { state: 'error'; message: string; fetchedAt: number; cachedCount?: number }

/** A Steam library collection (read-only, from the local Steam client data). */
export interface SteamCollection {
  id: string
  name: string
  /** explicit members (added minus removed); for dynamic collections only the manual additions */
  appIds: number[]
  dynamic: boolean
  kind: 'user' | 'favorite' | 'hidden'
}

export interface LibrarySnapshot {
  games: Game[]
  steam: {
    status: SteamClientStatus
    installPath?: string
    libraryFolders: string[]
    users: SteamUser[]
    activeSteamId?: string
    runningAppId?: number
  }
  account: AccountLibraryStatus
  /** null = Steam collections could not be read */
  collections: SteamCollection[] | null
  demo: boolean
  scannedAt: number
  warnings: string[]
  /** EmuStart engine and server (the Steam part is in `steam`) */
  emustart: EmustartSummary
  /** GOG games from the EmuStart server: catalog state */
  gog: GogSummary
  /** known emulated platforms (classification of Steam shortcuts by their tags); empty until the engine ran once */
  platforms: PlatformInfo[]
}

export interface GogSummary {
  /** the catalog shown is the last saved copy (server unreachable or engine not running) */
  fromCache: boolean
  error?: string
  games: number
}

/** One version of a game that has several (regions, revisions). */
export interface EmuVersion {
  /** emu:<sid> */
  id: string
  tags: string
  cached: boolean
  pinned: boolean
  copying: boolean
  discs: number
  size: number
  lastPlayed?: number
}

/** Which regional version a game shows by default. */
export type RegionOrder = 'europe' | 'usa' | 'japan'

export type EngineState = 'disabled' | 'starting' | 'ready' | 'missing' | 'error'

export interface EmuServerState {
  ok: boolean
  name?: string
  checking?: boolean
  key_rejected?: boolean
  reason?: string
}

export interface EmuSystem {
  es: string
  display: string
  games: number
  cached: number
  emulator: string
  /** platform family from EmuStart's system catalog (absent from older engines → classified as other) */
  family?: PlatformFamily
  /** the server has a logo of this platform (lumen-art: emusys:<es> / logo) */
  hasLogo?: boolean
  /** the server has a photo of the platform's console (lumen-art: emusys:<es> / hero) */
  hasConsole?: boolean
  /** author and licence of the console photo (shown with it) */
  consoleCredit?: string
  /** mean brightness of the console photo, 0–1 (the theme tones bright consoles down) */
  consoleLum?: number
  /** versions of the platform's logo / console photo (change when the server sets a new one) — part of
   *  their lumen-art address, so a new picture is not served from the renderer's image cache */
  logoRev?: number
  consoleRev?: number
  /** the logo is pixel art: size of one art pixel in file pixels (RetroArch dot-art 8, native pixel art 1) —
   *  shown only at whole-number zoom of the art pixels */
  logoPixel?: number
}

/** Platform description for the TV system carousel (EmuStart system_info) */
export interface EmuSystemInfo {
  pending?: boolean
  manufacturer?: string
  release?: string
  end?: string
  media?: string
  controllers?: string
  description?: string
}

export interface EmustartSummary {
  engine: EngineState
  /** why the engine is not ready (missing Python, crash…) */
  message?: string
  version?: string
  /** null = this device is not logged in to an EmuStart server */
  server: EmuServerState | null
  profile?: string
  systems: EmuSystem[]
  /** the library shown comes from the last saved copy (engine not running) */
  fromCache: boolean
  /** emulator root folder set on this PC */
  configured: boolean
}

/** what the list filters need about a PC game (Steam store, GOG, LaunchBox). players: 1, or 2 = two or more */
export interface GameFacts {
  genres?: string[]
  developer?: string
  year?: string
  players?: number
}

export interface GameDetails {
  appId: number
  fetchedAt: number
  source: 'steamStore' | 'launchbox' | 'emustart' | 'gog'
  name?: string
  shortDescription?: string
  descriptionHtml?: string
  /** plain-text description (LaunchBox) */
  descriptionText?: string
  genres?: string[]
  releaseDate?: string
  comingSoon?: boolean
  developers?: string[]
  publishers?: string[]
  website?: string
  players?: string
  /** community rating 0–5 (LaunchBox) */
  rating?: number
  /** how many ratings make `rating` (LaunchBox) */
  ratingCount?: number
  /** age rating (LaunchBox: "E - Everyone", "T - Teen"…) */
  esrb?: string
  /** can be played cooperatively (LaunchBox) */
  coop?: boolean
  /** has any multiplayer mode (Steam store categories) */
  multiplayer?: boolean
  /** LaunchBox release type: Released, Homebrew, Unlicensed… */
  releaseType?: string
  /** critics: Metacritic score 0–100 (Steam store) */
  criticScore?: number
  /** players: share of positive Steam reviews 0–100 and how many reviews */
  playerScore?: number
  playerReviews?: number
  platform?: string
  launchboxId?: number
  /** the LaunchBox entry the description was filled in from (GOG, shortcuts) */
  launchboxName?: string
  /** how many times the game was started (EmuStart) */
  plays?: number
  /** Steam store data format (3: with Metacritic, reviews, co-op, age rating) — older cache is refreshed */
  version?: number
}

export interface LaunchBoxStatus {
  ready: boolean
  updated?: string
  games?: number
  /** images listed (box art, backgrounds, logos…) */
  images?: number
  /** built by an older Lumen without the image list — rebuilt automatically */
  outdated?: boolean
  sizeBytes?: number
  error?: string
  job?: { phase: 'download' | 'build'; done: number; total: number }
}

export type DetailsResult =
  | { ok: true; details: GameDetails; stale: boolean }
  | { ok: false; error: string }

// ---------- User preferences (local only) ----------

export type SmartCategoryType = 'recent' | 'installed' | 'favorites' | 'notInstalled' | 'all'

export interface Category {
  id: string
  name: string
  /**
   * smart = built-in rule, custom = Lumen category, steam = mirror of a Steam collection (read-only),
   * emustart = platform (system) of the EmuStart server library (read-only, follows the server)
   */
  kind: 'smart' | 'custom' | 'steam' | 'emustart'
  smart?: SmartCategoryType
  steamCollectionId?: string
  emuSystem?: string
  pinned: boolean
  /** order among pinned categories on the home screen */
  order: number
}

export type ArtKind = 'grid' | 'hero' | 'logo' | 'icon'

export type ArtChoice =
  | { type: 'sgdb'; imageId: number; url: string; thumb?: string }
  | { type: 'file'; file: string }
  /** image uploaded to the EmuStart server (by this account or another one) */
  | { type: 'user'; sha: string; ext: string }
  | { type: 'steam' }
  /** image from LaunchBox Games DB (images.launchbox-app.com) */
  | { type: 'launchbox'; url: string }
  /** image found with the user's own IGDB / TheGamesDB key */
  | { type: 'web'; url: string }
  | { type: 'none' }

export interface UserArtItem {
  sha: string
  ext: string
  size: number
  by: string
  mine: boolean
  /** game or group it was uploaded for */
  game: string
}

export type UserArtGallery = { ok: true; items: UserArtItem[] } | { ok: false; error: string }

export interface OwnArtOption {
  url: string
  source: string
}

export type OwnArtResult = { ok: true; options: OwnArtOption[]; error?: string } | { ok: false; error: string }

export interface GameArtPrefs {
  sgdbGameId?: number
  sgdbGameName?: string
  grid?: ArtChoice
  hero?: ArtChoice
  logo?: ArtChoice
  icon?: ArtChoice
}

export interface Prefs {
  version: number
  categories: Category[]
  /** gameId -> custom category ids */
  gameCategories: Record<string, string[]>
  favorites: string[]
  art: Record<string, GameArtPrefs>
  /** when each art choice was made (<layout>|<game>|<kind> → seconds): the newest wins across devices */
  /** default art of library groups, set by the server's administrator (a player's own choice wins) */
  artDefaults: Record<string, { logo?: ArtChoice; hero?: ArtChoice }>
  artStamps: Record<string, number>
  /**
   * the TV layout's own art choices (cover / screenshot / logo shown differently than the desktop's
   * poster / background) — separate from `art`
   */
  artTv: Record<string, GameArtPrefs>
  /** game with several versions (emugrp:…) → the version the player chose (emu:<sid>) */
  versions: Record<string, string>
  /** Steam shortcut → platform chosen by the player: 'pc' | 'other' | 'emu:<es>' (ambiguous shortcuts) */
  platformOverrides: Record<string, string>
  /** library groups pinned for quick access (top bar / TV carousel), in order: nav ids like 'console/emu:ps2', 'pc/gog', 'col/<categoryId>' */
  pinnedGroups: string[]
  /** names in LaunchBox set by the server's administrator (GOG games, shortcuts): game id → name; a copy of the server's */
  lbTitles: Record<string, string>
}

/** a game's name in LaunchBox (set by the server's administrator) and whether this device may change it */
export interface LbTitleInfo {
  name: string
  admin: boolean
}

/** ratings of a game for sorting lists: LaunchBox community (0–5), critics (Metacritic 0–100), players (Steam reviews % positive) */
export interface GameRatings {
  launchbox?: number
  critic?: number
  players?: number
}

/** which layout an art choice belongs to (the TV layout keeps its own) */
export type ArtLayout = 'desktop' | 'tv'

export type ArtSourcePriority = 'sgdbFirst' | 'steamFirst'
/** where a game's own art and data come from: Steam, the EmuStart server's GOG folder, EmuStart games (server + LaunchBox) */
export type ArtDataSource = 'steam' | 'gog' | 'launchbox'
export type AfterLaunch = 'minimize' | 'keep'
/** xinput = passive XInput polling in the main process (default); chromium = browser Gamepad API */
/** One connected XInput pad (raw XINPUT_GAMEPAD values). */
export interface PadState {
  index: number
  buttons: number
  lt: number
  rt: number
  lx: number
  ly: number
}

export type GamepadBackend = 'xinput' | 'chromium'

export interface Settings {
  version: 1
  steamIdOverride?: string
  artPriority: ArtSourcePriority
  /** data sources whose own art stays first although artPriority is sgdbFirst */
  sgdbFirstOff: ArtDataSource[]
  afterLaunch: AfterLaunch
  restoreAfterGame: boolean
  startFullscreen: boolean
  showTools: boolean
  demoMode: boolean
  gamepadBackend: GamepadBackend
  /** interface shown at start: desktop (Lumen look) or fullscreen (EmuStart look) */
  startMode: UiMode
  /** regional version shown by default for games with several versions */
  regionOrder: RegionOrder
  /** run the EmuStart engine (emulated games from an EmuStart server) */
  emustartEnabled: boolean
  /** EmuStart data folder (config, game cache, profiles); empty = Lumen's own folder */
  emustartHome?: string
  /** Python used to run the engine from sources (dev); empty = bundled engine or `py -3` */
  pythonPath?: string
  /** filled in by the main process: XInput could be loaded on this PC */
  xinputAvailable?: boolean
  language: string
  /** shared folder for GOG games installed from the EmuStart server; each game gets its own subfolder */
  gogInstallDir: string
  /** default languages offered when installing a GOG game (short codes: pl, en…), in order of preference */
  gogLanguages: string[]
  /** theme of the TV layout (renderer: tv/themes.ts); an unknown id falls back to the default */
  tvTheme: string
  /**
   * the look editor's values per TV theme (only what differs from the theme's defaults). The EmuStart
   * theme keeps its look in EmuStart's shared config; here only Lumen's own keys (typefaces).
   */
  tvLooks: Record<string, Record<string, number | string>>
  /** animacje trybu TV (tło motywu, dekoracje z paczek): wył. / niskie / średnie / wysokie; przy ograniczonym ruchu
   *  w Windows — wył. bez względu na to ustawienie */
  tvAnim: TvAnim
  /** the optional desktop interface (shared/deck.ts); off by default */
  deck: DeckSettings
  hasSgdbKey: boolean
  hasSteamWebKey: boolean
  hasIgdbId: boolean
  hasIgdbSecret: boolean
  hasTgdbKey: boolean
  secretsEncrypted: boolean
}

export type SettingsPatch = Partial<
  Pick<
    Settings,
    | 'steamIdOverride'
    | 'artPriority'
    | 'sgdbFirstOff'
    | 'afterLaunch'
    | 'restoreAfterGame'
    | 'startFullscreen'
    | 'showTools'
    | 'demoMode'
    | 'gamepadBackend'
    | 'startMode'
    | 'regionOrder'
    | 'emustartEnabled'
    | 'emustartHome'
    | 'pythonPath'
    | 'tvTheme'
    | 'tvLooks'
    | 'tvAnim'
    | 'gogInstallDir'
    | 'gogLanguages'
  >
> & {
  /** only the fields given change (the main window and the Deck window both edit the Deck settings) */
  deck?: Partial<DeckSettings>
}

export type SecretName = 'sgdbApiKey' | 'steamWebApiKey' | 'igdbClientId' | 'igdbClientSecret' | 'tgdbApiKey'

export interface SgdbGame {
  id: number
  name: string
  releaseDate?: number
  verified?: boolean
}

export interface ArtOption {
  id: number
  url: string
  thumb: string
  width: number
  height: number
  style?: string
  score?: number
  author?: string
  /** animated (APNG / WebP / GIF); its thumb may be a short video */
  animated?: boolean
}

/** An image from LaunchBox Games DB offered in the "Grafiki" window */
export interface LbArtOption {
  url: string
  /** LaunchBox type: "Box - Front", "Fanart - Background", "Clear Logo"… */
  type: string
  region: string
}

export type LbArtOptionsResult = { ok: true; options: LbArtOption[] } | { ok: false; error: string }

export type ArtOptionsResult =
  | { ok: true; sgdbGame?: SgdbGame; options: ArtOption[]; page: number; hasMore: boolean }
  | { ok: false; error: string }

export interface CacheStats {
  files: number
  bytes: number
}

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string }

// ---------- GOG: saves and settings synced through the EmuStart server (engine/emustart/gogsaves.py) ----------

/** both the server and this device changed a file set since the last sync — the player decides */
export interface GogSaveConflict {
  kind: string
  template: string
  serverRevision: number
  serverTime: number
  serverDevice: string
  localTime: number
  localFiles: number
}

export interface GogSaveSet {
  id: string
  kind: 'saves' | 'config'
  /** the rule (with placeholders such as <winAppData>) */
  template: string
  /** where it is on this computer */
  folder: string
  pattern: string
  files: number
  exists: boolean
  error: string
}

export interface GogSavesStatus {
  ok: boolean
  reason?: string
  enabled: boolean
  config: boolean
  userRules: { files: { path: string; tags: string[] }[] } | null
  pick: string
  /** user = this player's own rules, server = the EmuStart server's correction, ludusavi = ludusavi-manifest */
  source: 'user' | 'server' | 'ludusavi' | 'ambiguous' | 'none'
  title: string
  version: string
  attribution: string
  candidates: string[]
  offline: string
  sets: GogSaveSet[]
  skipped: { path: string; kind: string; reason: string }[]
  registry: { path: string; kind: string; reason: string }[]
  needsRegistry: boolean
  /** this device is logged in to an EmuStart account */
  profile: boolean
  running: boolean
  lastSync: number
  pending: number
  last: { at?: number; ok?: boolean; message?: string }
}

export type GogLaunchResult = ActionResult & { conflict?: GogSaveConflict[] }
export type GogSaveChoice = 'local' | 'remote' | 'skip'
export interface GogExtrasResult {
  items: GogExtra[]
  target: string
}


// ---------- jobs (one queue for both interfaces) ----------

export type JobKind = 'steamDownload' | 'emuLaunch' | 'emuDownload' | 'emuInstall' | 'saveUpload' | 'libraryRefresh' | 'gogInstall'

export interface JobProgress {
  done: number
  total: number
  /** bytes per second */
  speed?: number
  /** seconds */
  eta?: number
}

/**
 * One task shown in both interfaces. Built from the real state of the integration that runs it:
 * Steam manifests (Steam runs the download) or the EmuStart engine.
 */
export interface Job {
  id: string
  kind: JobKind
  source: 'steam' | 'emustart' | 'gog'
  gameId?: string
  title: string
  /** human readable phase, e.g. "Pobieranie", "Rozpakowywanie", "Gra uruchomiona" */
  phase: string
  /** waiting = the job needs a decision from the player (e.g. a save conflict) */
  state: 'active' | 'running' | 'done' | 'error' | 'cancelled' | 'queued' | 'waiting'
  progress?: JobProgress
  message?: string
  cancellable: boolean
  /** Steam runs this download — Lumen can only show it and open the Steam window */
  managedBySteam?: boolean
}

/** EmuStart launch session as reported by the engine (launch_status). */
export interface EmuLaunchStatus {
  phase: 'idle' | 'preparing' | 'downloading' | 'extracting' | 'running' | 'finished' | 'error' | 'cancelled' | 'conflict'
  game_id?: number
  title?: string
  system?: string
  message?: string
  mode?: string
  copying?: boolean
  locked_by?: string
  missing_core?: boolean
  notice?: string
  progress?: { done: number; total: number; left?: number; speed?: number; eta?: number; file?: number; files?: number }
  /** phase "conflict": save bundles changed here and on another device (syncclient Conflict.describe) */
  conflict?: EmuSaveConflict[]
}

export interface EmuSaveConflict {
  emulator: string
  core: string
  kind: 'saves' | 'states' | 'memcards' | string
  server_revision: number
  /** unix seconds */
  server_time: number
  server_device: string
  local_time: number
  local_files: number
}

/** Save sync of one game with the server (syncclient.status). */
export interface EmuSaveSync {
  state: 'synced' | 'pending' | 'never' | 'offline' | string
  /** unix seconds */
  last: number
}

/**
 * Account, login and profile calls of the EmuStart engine the interface may make (the logic is
 * EmuStart's: api.py — login with a device key, profiles, PIN, account passwords, RetroAchievements).
 */
export type EmuAccountMethod =
  | 'get_state'
  | 'server_enroll'
  | 'server_enroll_poll'
  | 'server_enroll_cancel'
  | 'server_logout'
  | 'enroll_pending'
  | 'enroll_decide'
  | 'profiles_list'
  | 'profile_select'
  | 'profile_setup'
  | 'profile_create'
  | 'profile_rename'
  | 'profile_delete'
  | 'profile_join'
  | 'profile_login'
  | 'profile_logout'
  | 'profile_unlock'
  | 'profile_set_pin'
  | 'profile_clear_pin'
  | 'profile_set_password'
  | 'ra_status'
  | 'ra_login'
  | 'ra_logout'
  | 'ra_hardcore'
  | 'ra_import'
  | 'ingame_poll'
  | 'ingame_action'
  | 'pads_state'
  | 'pads_set'
  | 'lumen_controllers'
  | 'lumen_controller_label'
  | 'lumen_controller_profile'
  | 'lumen_controller_profile_set'
  | 'lumen_hide_status'
  | 'lumen_hide_setup'
  | 'autodetect'
  | 'install_missing'
  | 'system_options'
  | 'system_set'
  | 'system_logo_choose'
  | 'look_save'

/** Options of one platform (EmuStart's system options: hold A on the logo; TV: X) */
export interface EmuSystemOptions {
  es: string
  display: string
  default_name: string
  logo: string
  glow: boolean
  /** this device's account administers the server (logo, glow and name — for every device) */
  admin: boolean
  emulator: string
  options: EmuEmulatorOption[]
  /** what the server would install (empty when an emulator is there) */
  install: { label: string }[]
}

/** A logo candidate of a platform on the server (administrator) */
export interface EmuSystemLogo {
  id: string
  /** preview as a data: URL ('' = no logo, show the name) */
  thumb: string
  source: string
  label?: string
}

/** In-game menu (Select + A over the emulator) as the engine shows it (ingame_poll) */
export interface EmuInGameMenu {
  open: boolean
  items: { id: string; label: string; on: boolean; hint?: string }[]
  title: string
  message: string
  seq: number
  /** controller presses the engine read itself since the last poll (up / down / a / b) */
  inputs: string[]
}

/** XInput controllers and the player order the engine applies when a game starts */
export interface EmuPadsState {
  pads: { slot: number; wireless?: boolean; battery?: string; kind?: string; buttons: number }[]
  order: number[]
  mode: 'windows' | 'wireless_first' | 'manual'
  manual: number[]
}

/** A game controller seen by Lumen (lumen_pads.py) — also non-XInput ones (wheels, PS pads) */
export interface LumenController {
  /** stable key: vid:pid:sn:<serial> | vid:pid:bt:<mac> | vid:pid:hid:<hash> */
  key: string
  /** short ID for the screen: "vid:pid·tail" */
  short: string
  label: string
  name?: string
  bus: string
  bus_label: string
  xinput_slot?: number | null
}

export interface LumenControllers {
  devices: LumenController[]
  /** registered, not connected now */
  missing: LumenController[]
  /** keys of saved profiles: default | emu:<family> | game:<id> | steam:<appid> */
  profiles: string[]
}

/** Controller profile: player order (stable keys), hidden devices, devices outside the profile */
export interface LumenPadProfile {
  order: string[]
  hidden: string[]
  unknown: 'passthrough' | 'ignore' | 'hide'
}

export interface LumenPadProfileState extends LumenControllers {
  key: string
  /** emulator family of the key ('' = unknown, e.g. a game without an emulator) */
  family: string
  family_label: string
  /** this key's own profile (null = none) */
  profile: LumenPadProfile | null
  /** the profile that applies: game → emulator → default (null = EmuStart's controller order) */
  effective: string | null
  effective_profile: LumenPadProfile | null
  ok?: boolean
  reason?: string
}

/** A profile on this device (profiles_list) */
export interface EmuProfile {
  id: number
  name: string
  nas_name?: string
  /** ok | need_pin | need_password | set_password */
  pin: string
  has_pin: boolean
}

/** Metadata fields of an EmuStart game (server metadata; an administrator can correct them) */
export type EmuMetaField = 'title' | 'developer' | 'publisher' | 'year' | 'genre' | 'players' | 'description'

/** Everything the "Opcje gry" window shows for an EmuStart game (lumen_game_options) */
export interface EmuGameOptions {
  /** engine number of the version that plays (translation or the game itself) */
  playId: number
  /** translations / versions of this game chosen per profile; empty = only the original */
  variants: { id: number; label: string; lang?: string }[]
  variant: number
  variantLabel: string
  meta: Partial<Record<EmuMetaField, string>>
  /** fields corrected by hand on the server */
  metaEdits: Partial<Record<EmuMetaField, string>>
  cached: boolean
  pinned: boolean
  /** bytes on this PC */
  local: number
  /** emulator of this game; own = chosen for this game (not the system's) */
  emulator: { label: string; exe: string; args: string; own: boolean }
  /** emulators found on this PC for the system */
  emulators: EmuEmulatorOption[]
  retroarch: boolean
  shaderOff: boolean
  system: string
  es: string
  sync: EmuSaveSync
  /** save states in the game's bundle */
  states: number
  /** save slots of the game on this PC (EmuStart 0.50); empty = the emulator has no save bundles */
  slots: EmuSaveSlot[]
  /** this device's account administers the server (edit metadata and server art) */
  admin: boolean
}

/** One change of emulator settings in the profile (restore = settings from before it) */
export interface EmuSettingsChange {
  id: string
  time: number
  label?: string
  files: string[]
}

/** Art candidate on the EmuStart server (administrator: box / snap / logo of a game) */
export interface EmuServerArt {
  url: string
  thumb: string
  source?: string
  width?: number
  height?: number
}

/** A save state of a game on this PC (EmuStart's "Wczytaj zapis" list) */
export interface EmuLocalState {
  path: string
  /** "Kontynuuj", "Stan #3", or the file name */
  label: string
  /** unix seconds */
  time: number
  /** picture the emulator stored with the state (data: URL) */
  thumb?: string
  resume?: boolean
  /** name of the state in the game's save bundle — launch with "arc:<arc>" (EmuStart 0.48.1) */
  arc?: string
  /** state saved by another core of this game: playing it switches the game to that core */
  otherCore?: string
  /** RetroArch's "Kontynuuj" (autosave) */
  continue?: boolean
  /** "rdzeń bsnes — nie wczyta się w snes9x" */
  detail?: string
}

/** A PS2 state on the server, from this PC or the phone (EmuStart's save manager) */
export interface EmuRemoteState {
  platform: 'windows' | 'android' | string
  label: string
  slot: string
  rel: string
  name: string
  size: number
  mtime: number
  targets: { platform: string; emu: string; label: string; ok: boolean | null; note: string }[]
}

/** Everything the desktop shows about a game's saves */
/** One save slot ("przejście") of a game: its own states, in-game saves and memory cards (EmuStart 0.50) */
export interface EmuSaveSlot {
  slot: number
  /** in the emulator's folders — the game starts on it */
  active: boolean
  states: number
  /** in-game saves / memory card files */
  saves: number
  /** newest file, unix seconds (0 = empty) */
  time: number
  /** states in this slot's trash */
  trash: number
}

/** A deleted save state in the active slot's trash (restore puts it back) */
export interface EmuTrashState {
  /** another RetroArch core's trash (state from „Wczytaj zapis” → otherCore) */
  core?: string
  /** name in the trash */
  name: string
  arc: string
  label: string
  time: number
  thumb?: string
}

/** What a state can be changed to: free numbers and the other slots */
export interface EmuStateEditInfo {
  numbers: number[]
  slots: number[]
  slot: number
  retroarch: boolean
}

export type EmuStateEditOp = 'renumber' | 'copy_new' | 'copy_slot' | 'move_slot' | 'continue' | 'delete' | 'restore'

export interface EmuSaves {
  sync: EmuSaveSync & { bundles: number }
  states: EmuLocalState[]
  /** save slots of the game (empty — the emulator has no save bundles) */
  slots: EmuSaveSlot[]
  /** PS2 states of this PC and the phone; absent with a reason when the server is out of reach */
  remote: { ok: true; here: string; states: EmuRemoteState[] } | { ok: false; reason: string }
}

/** How the player settles a save conflict: keep this device's version, take the server's, or skip sync this time. */
export type SaveChoice = 'local' | 'remote' | 'skip'

export interface SaveConflict {
  profile?: string
  file?: string
  at?: number
  [k: string]: unknown
}

export interface EmuRuntime {
  launch: EmuLaunchStatus
  /** save files waiting to be sent to the server ("" = none) */
  postPending: string
  conflicts: SaveConflict[]
  server: EmuServerState | null
}

export interface JobsSnapshot {
  jobs: Job[]
  emu: EmuRuntime | null
}

export type EmuMissing = { kind: 'emulator'; es: string; system: string; installable: boolean; steps: string[] }

export type EmuReadiness =
  | { ok: true; emulator: string; system: string; missing: EmuMissing[]; sync?: EmuSaveSync }
  | { ok: false; reason: string }

export interface EmuActionResult {
  ok: boolean
  message?: string
  error?: string
  /** the profile is locked on this device (PIN / account password) — choose or unlock it */
  profileLocked?: boolean
  /** launch could not start: these components are missing */
  needInstall?: { es: string; system: string; steps: string[] }
}

export interface EmuSettings {
  dataDir: string
  emuRoot: string
  cacheDir: string
  cacheRecent: number
  account?: string
  serverVia?: string
  enroll?: { url?: string; code?: string } | null
  profiles: { id: number; name: string }[]
  profileId?: number
}

export type UiMode = 'desktop' | 'fullscreen'

/** EmuStart library settings shared by both interfaces (stored by the engine, per profile where EmuStart does so). */
export interface EmuOptions {
  hide: { beta: boolean; demo: boolean; pirate: boolean; unl: boolean; program: boolean }
  arcadeClones: boolean
  cacheRecent: number
  streamPlay: boolean
  streamMinSeconds: number
  /** WinFsp state ("dostępny" = streaming possible) */
  winfsp: string
  askProfile: boolean
  profileSettings: boolean
  machineProfile?: number
  profiles: { id: number; name: string }[]
  systems: { es: string; display: string; enabled: boolean; emulator: string; known: boolean }[]
  /** TV layout: the game's Clear Logo instead of its title (when there is one) */
  gamesLogo: boolean
}

export type EmuOptionsPatch = Partial<{
  hide: Partial<EmuOptions['hide']>
  arcadeClones: boolean
  cacheRecent: number
  streamPlay: boolean
  streamMinSeconds: number
  askProfile: boolean
  profileSettings: boolean
  machineProfile: number
  gamesLogo: boolean
  /** where EmuStart keeps the TV look: with the profile (every computer) or only on this computer */
  lookScope: 'profile' | 'machine'
}>

export interface EmuEmulatorOption {
  label: string
  exe: string
  args: string
}

// ---------- self-update (GitHub releases, like EmuStart) ----------

/** zip = folder version, installed = setup.exe, portable = single exe, dev = from sources (no updates) */
export type UpdateFlavor = 'zip' | 'installed' | 'portable' | 'dev'

export interface UpdateInfo {
  version: string
  current: string
  newer: boolean
  flavor: UpdateFlavor
  /** the release file for this build */
  file?: { name: string; url: string; size: number; sha256: string }
  sigUrl?: string
  notes: string
  page: string
  published: string
}

export interface UpdateState {
  phase: 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'verifying' | 'extracting' | 'ready' | 'applying' | 'error'
  info?: UpdateInfo
  done: number
  total: number
  error?: string
  checkedAt?: number
}

// ---------- in-app path picker (gamepad friendly, no system dialog) ----------

export interface FsEntry {
  name: string
  path: string
  /** place = shortcut on the first page (Lumen data, Desktop…) */
  kind: 'drive' | 'dir' | 'file' | 'place'
  note?: string
}

export interface FsListOptions {
  kind: 'folder' | 'file'
  /** file mode: allowed extensions without the dot, e.g. ["png", "jpg"] */
  extensions?: string[]
}

export interface FsListing {
  /** '' = first page (shortcuts and drives) */
  path: string
  /** null on the first page; '' = back to the first page */
  parent: string | null
  entries: FsEntry[]
  truncated: boolean
  error?: string
}

// ---------- GOG games from the EmuStart server ----------

/** What the install window offers (only what the server really has complete) */
export interface GogInstallOptions {
  ok: true
  title: string
  buildId: string
  version: string
  languages: string[]
  /** settings' preferred languages available for this game (may be empty — then the player chooses) */
  defaultLanguages: string[]
  dlcs: { id: string; name: string; hasFiles: boolean }[]
  dependencies: string[]
  size: number
  /** folder the game goes to: <shared GOG folder>/<game folder from the archive> */
  target: string
  free: number | null
  installed?: { state: GogInstallState; dlcs: string[]; languages: string[] } | null
  updateNote?: string
}

export type GogOptionsResult = GogInstallOptions | { ok: false; error: string }

export interface GogInstallRequest {
  languages: string[]
  primary: string
  dlcs: string[]
}

export interface GogPlayTask {
  index: number
  name: string
  category: string
  default: boolean
}

export interface GogVerifyResult {
  ok: boolean
  checked?: number
  badCount?: number
  bad?: { path: string; why: string }[]
  error?: string
}

/**
 * Motyw trybu TV z paczki pobranej z serwera EmuStart (engine/emustart/themes.py — sprawdzona jak na serwerze).
 * Pliki: lumen-theme://<id>/<plik> (tylko pliki pakietu).
 */
export interface ThemePackage {
  id: string
  name: string
  description: string
  author: string
  version: string
  palette?: { bg: string; text: string; dim: string; accent: string; selText: string; selBg: string; panel: string }
  games: { layout: 'list' | 'coverflow'; reflection: boolean }
  logoPlate: boolean
  consoleBackdrop: boolean
  ambient: 'none' | 'embers' | 'stars'
  locks: string[]
  fonts: { text: string[]; head: string[] }
  fontFaces: { name: string; file: string }[]
  /** poziomy animacji, które motyw obsługuje (off, low, med, high) */
  animations: string[]
  /** domyślne grafiki kategorii: klucz (rodzina / grupa) → plik z assets/ */
  categories: Record<string, string>
  hasLayers: boolean
  /** zmienia się z każdą wersją plików — do adresów (pamięć przeglądarki) */
  rev: string
}

export type TvAnim = 'off' | 'low' | 'med' | 'high'
export const TV_ANIM_LEVELS: TvAnim[] = ['off', 'low', 'med', 'high']
