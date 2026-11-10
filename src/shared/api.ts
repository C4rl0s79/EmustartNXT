import type { GameFacts, OwnArtResult, UserArtGallery } from './types'
import type { DeckGeometry, DeckGroupOp, DeckLayoutStep } from './deck'
import type { EmuSystemLogo, EmuAccountMethod, EmuServerArt, EmuMetaField, EmuSettingsChange, EmuGameOptions, EmuSystemInfo, LbArtOptionsResult, EmuSaves, EmuStateEditInfo, EmuStateEditOp, EmuTrashState,
  ActionResult,
  ArtKind, ArtLayout,
  GameRatings,
  ArtOption,
  ArtOptionsResult,
  CacheStats,
  DetailsResult,
  EmuActionResult,
  EmuReadiness,
  EmuSettings,
  EmuOptions,
  EmuOptionsPatch,
  EmuEmulatorOption,
  UpdateState,
  FsListing,
  FsListOptions,
  SaveChoice,
  JobsSnapshot,
  UiMode,
  LaunchBoxStatus,
  LbTitleInfo,
  PadState,
  LibrarySnapshot,
  Prefs,
  SecretName,
  Settings,
  SettingsPatch,
  SgdbGame,
  GogInstallRequest,
  GogOptionsResult,
  GogPlayTask,
  GogVerifyResult,
  GogLaunchResult,
  GogSaveChoice,
  GogExtrasResult,
  SteamFamilyStatus,
  GogSavesStatus
} from './types'

/** In-app path picker (renderer: pickPath in store.ts). */
export interface PickPathOptions extends FsListOptions {
  title: string
  /** folder to open first; empty = shortcuts and drives */
  start?: string
}

/** The API exposed on window.lumen by the preload script. */
export interface LumenApi {
  library: {
    familyStatus(): Promise<SteamFamilyStatus>
    familyLogin(): Promise<SteamFamilyStatus>
    familyLogout(): Promise<SteamFamilyStatus>
    get(): Promise<LibrarySnapshot>
    refresh(includeAccount: boolean): Promise<LibrarySnapshot>
    onSnapshot(cb: (s: LibrarySnapshot) => void): () => void
    /**
     * ratings of these games (for sorting): what is known now; `missing` Steam games are looked up
     * in the store in the background (ask again later)
     */
    ratings(gameIds: string[]): Promise<{ ratings: Record<string, GameRatings>; missing: number }>
    /** filter data of PC games; `missing` Steam games are looked up in the background */
    facts(gameIds: string[]): Promise<{ facts: Record<string, GameFacts>; missing: number }>
  }
  game: {
    play(gameId: string): Promise<ActionResult>
    install(gameId: string): Promise<ActionResult>
    openInSteam(gameId: string, view: 'details' | 'store' | 'downloads'): Promise<ActionResult>
    details(gameId: string, force?: boolean): Promise<DetailsResult>
  }
  prefs: {
    get(): Promise<Prefs>
    toggleFavorite(gameId: string): Promise<Prefs>
    setGameCategories(gameId: string, categoryIds: string[]): Promise<Prefs>
    createCategory(name: string): Promise<Prefs>
    renameCategory(id: string, name: string): Promise<Prefs>
    deleteCategory(id: string): Promise<Prefs>
    setPinned(id: string, pinned: boolean): Promise<Prefs>
    moveCategory(id: string, delta: number): Promise<Prefs>
    /** platform of an ambiguous Steam shortcut ('pc' | 'other' | 'emu:<es>'; null = automatic) */
    setPlatformOverride(gameId: string, value: string | null): Promise<Prefs>
    /** pin a library subgroup (e.g. 'console/emu:ps2', 'pc/gog') for quick access in both layouts */
    setGroupPinned(id: string, pinned: boolean): Promise<Prefs>
    moveGroupPin(id: string, delta: number): Promise<Prefs>
    onChange(cb: (p: Prefs) => void): () => void
  }
  /** GOG games from the EmuStart server — every action runs in the EmuStart engine (engine/emustart/goglib.py) */
  gog: {
    /** what the install window offers: complete languages and DLC on the server, folder, free space */
    options(gameId: string): Promise<GogOptionsResult>
    install(gameId: string, req: GogInstallRequest): Promise<ActionResult>
    /** continue an interrupted install, finish a DLC install, or repair damaged files */
    resume(gameId: string): Promise<ActionResult>
    addDlc(gameId: string, dlcs: string[]): Promise<ActionResult>
    cancel(gameId: string): Promise<ActionResult>
    verify(gameId: string): Promise<GogVerifyResult>
    /** installed game — works without the server; task = one of playTasks (default: the game's own) */
    launch(gameId: string, task?: number, syncChoice?: GogSaveChoice): Promise<GogLaunchResult>
    /** saves and settings: rules (source), paths on this computer, sync state */
    extras(gameId: string): Promise<GogExtrasResult>
    extrasDownload(gameId: string, ids: string[]): Promise<ActionResult>
    saves(gameId: string, refresh?: boolean): Promise<GogSavesStatus>
    savesSet(gameId: string, opts: { enabled?: boolean; config?: boolean; pick?: string; rules?: { files: { path: string; tags: string[] }[] } | null }): Promise<ActionResult>
    savesSync(gameId: string, choice?: GogSaveChoice): Promise<GogLaunchResult>
    savesBackups(gameId: string): Promise<{ id: string; sets: string[] }[]>
    savesRestore(gameId: string, backupId: string): Promise<ActionResult>
    playTasks(gameId: string): Promise<GogPlayTask[]>
    /** removes only the files installed by Lumen; saves and the player's files stay; the server archive is never touched */
    uninstall(gameId: string): Promise<ActionResult>
    /** HKLM registry steps of the game's installer — shows Windows' UAC prompt */
    finishAdmin(gameId: string): Promise<ActionResult>
    /** system libraries (Visual C++, DirectX) from the game's dependencies — each with a UAC prompt */
    installRuntimes(gameId: string): Promise<ActionResult>
    refresh(): Promise<ActionResult>
    /** a GOG job ended (installed, failed, cancelled) — for a toast in either layout */
    onMessage(cb: (m: { gameId: string; title: string; ok: boolean; message: string }) => void): () => void
  }
  settings: {
    get(): Promise<Settings>
    patch(p: SettingsPatch): Promise<Settings>
    setSecret(name: SecretName, value: string | null): Promise<Settings>
    onChange(cb: (s: Settings) => void): () => void
  }
  art: {
    /**
     * layout 'tv': the TV layout's art (its own choices, LaunchBox first for EmuStart games); anim: with thumb,
     * an animated poster as it is, not its list copy (first frame) — the Deck's tiles and the desktop lists
     */
    url(gameId: string, kind: ArtKind, rev?: number, layout?: ArtLayout, thumb?: boolean, anim?: boolean): string
    /** page: the next SteamGridDB page (0 = first, PAGE_SIZE each), animated images included */
    options(gameId: string, kind: ArtKind, page?: number): Promise<ArtOptionsResult>
    search(term: string): Promise<{ ok: true; games: SgdbGame[] } | { ok: false; error: string }>
    setMatch(gameId: string, sgdbGame: SgdbGame | null): Promise<Prefs>
    choose(gameId: string, kind: ArtKind, option: ArtOption, layout?: ArtLayout): Promise<Prefs>
    /** LaunchBox Games DB images of an EmuStart game (by the LaunchBox id from the server) */
    launchboxOptions(gameId: string, kind: ArtKind): Promise<LbArtOptionsResult>
    chooseLaunchbox(gameId: string, kind: ArtKind, url: string, layout?: ArtLayout): Promise<Prefs>
    /** use an image file chosen in the in-app picker (copied into Lumen's data folder) */
    useFile(gameId: string, kind: ArtKind, file: string, layout?: ArtLayout): Promise<Prefs>
    useSteam(gameId: string, kind: ArtKind, layout?: ArtLayout): Promise<Prefs>
    reset(gameId: string, kind: ArtKind, layout?: ArtLayout): Promise<Prefs>
    /** images uploaded to the server by its accounts (this game, this kind) */
    /** gameId '' = everything uploaded to the server */
    userGallery(gameId: string, kind: ArtKind): Promise<UserArtGallery>
    ownOptions(gameId: string, kind: ArtKind): Promise<OwnArtResult>
    /** the art source keys: from PyLinks on this PC (file null) or from an encrypted file */
    keysImport(file: string | null, password: string): Promise<Settings>
    keysExport(folder: string, password: string): Promise<string>
    chooseOwn(gameId: string, kind: ArtKind, url: string, layout?: ArtLayout): Promise<Prefs>
    chooseUser(gameId: string, kind: ArtKind, sha: string, ext: string, layout?: ArtLayout): Promise<Prefs>
    onChanged(cb: (gameId: string, rev: number) => void): () => void
  }
  launchbox: {
    status(): Promise<LaunchBoxStatus>
    update(): Promise<LaunchBoxStatus>
    cancel(): Promise<void>
    onChange(cb: (s: LaunchBoxStatus) => void): () => void
    /** name of a GOG game / shortcut in LaunchBox set by the server's administrator */
    title(gameId: string): Promise<LbTitleInfo>
    /** administrator: the name on the server for every device (empty = search by the store name) */
    setTitle(gameId: string, name: string): Promise<ActionResult>
  }
  /** EmuStart games: every action runs in the EmuStart engine (engine/emustart) */
  emustart: {
    /**
     * `state`: path of a save state on this PC (from saves()) to start from; `takeover`: the
     * profile is playing on another device (lock) and the player chose to take it over
     */
    launch(gameId: string, state?: string, takeover?: boolean): Promise<EmuActionResult>
    /** a state of another RetroArch core: switch this game to that core (downloads it if missing) */
    playOtherCore(gameId: string, core: string): Promise<EmuActionResult>
    /** account, login and profiles (EmuStart engine calls on a whitelist) — raw engine result */
    account<T = Record<string, unknown>>(method: EmuAccountMethod, ...args: unknown[]): Promise<T>
    /** administrator: logo candidates of a platform on the server (previews) */
    systemLogos(es: string): Promise<EmuSystemLogo[]>
    /** "Opcje gry": versions, emulator, settings, metadata (one call) */
    gameOptions(gameId: string): Promise<EmuGameOptions>
    /** version of the game for this profile (translation id, 0 = original) */
    setVariant(gameId: string, variantId: number): Promise<EmuActionResult>
    /** emulator for this game only; null = the system's emulator */
    setGameEmulator(gameId: string, emulator: EmuEmulatorOption | null): Promise<EmuActionResult>
    /** the game's emulator without the game — change its settings in the player's profile */
    configureEmulator(gameId: string): Promise<EmuActionResult>
    emuSettingsHistory(gameId: string): Promise<EmuSettingsChange[]>
    /** settings from before this change */
    emuSettingsRestore(gameId: string, changeId: string): Promise<EmuActionResult>
    /** RetroArch in this system without the shader */
    setShaderOff(es: string, off: boolean): Promise<EmuActionResult>
    /** administrator: correct metadata on the server ({} = back to downloaded data) */
    metaSave(gameId: string, edits: Partial<Record<EmuMetaField, string>>): Promise<EmuActionResult>
    /** administrator: the server fetches the description from the web */
    metaFetchFull(gameId: string): Promise<EmuActionResult>
    /** administrator: art candidates on the server (box / snap / logo) */
    serverArt(gameId: string, kind: 'box' | 'snap' | 'logo', query?: string): Promise<EmuServerArt[]>
    serverArtChoose(gameId: string, kind: 'box' | 'snap' | 'logo', url: string): Promise<EmuActionResult>
    serverArtClear(gameId: string, kind: 'box' | 'snap' | 'logo'): Promise<EmuActionResult>
    /** platform description for the TV system carousel (pending = being fetched, ask again) */
    systemInfo(es: string): Promise<EmuSystemInfo>
    /** sync status, save states on this PC, PS2 states of all devices */
    saves(gameId: string): Promise<EmuSaves>
    /** copy a PS2 state to the other platform (or here) */
    copyState(gameId: string, rel: string, platform: string, emu: string): Promise<EmuActionResult>
    /** the game's active save slot (1–4): the engine swaps the files (not while the game runs) */
    setSaveSlot(gameId: string, slot: number): Promise<EmuActionResult>
    /** free state numbers and the other slots (state editing) */
    stateEditInfo(gameId: string): Promise<EmuStateEditInfo>
    /** change a state of the active slot (arc from saves(); restore: name in the trash) */
    stateEdit(gameId: string, op: EmuStateEditOp, arc: string, arg?: number, core?: string): Promise<EmuActionResult>
    /** deleted states of the active slot */
    stateTrash(gameId: string, core?: string): Promise<EmuTrashState[]>
    /** progress of a save upload / download running in the engine (big GameCube states) */
    syncProgress(): Promise<{ active: boolean; op?: 'send' | 'get' | 'pack'; done?: number; total?: number; eta?: number }>
    /** stop the download of the game being launched */
    cancelLaunch(): Promise<void>
    /** close the finished / failed launch session */
    dismiss(): Promise<void>
    /** save conflict before a game: which version wins (the other one is kept in history / backup) */
    resolveConflict(choice: SaveChoice): Promise<boolean>
    /** keep the game on this PC (download now, outside the "last N games" limit) or stop keeping it */
    toggleKeep(gameId: string): Promise<EmuActionResult>
    removeLocal(gameId: string): Promise<EmuActionResult>
    readiness(gameId: string): Promise<EmuReadiness>
    /** controller profile key of the game ("game:<id>" of the version that plays) */
    controllerKey(gameId: string): Promise<string>
    installEmulators(systems: string[]): Promise<EmuActionResult>
    settings(): Promise<EmuSettings>
    /** folder chosen in the in-app picker */
    setFolder(key: 'emu_root' | 'cache_dir', folder: string): Promise<EmuSettings>
    refreshLibrary(): Promise<EmuActionResult>
    restartEngine(): Promise<void>
    clearConflicts(): Promise<void>
    /** library settings shared with the TV interface: hiding, cache, streaming, profiles, systems */
    options(): Promise<EmuOptions>
    setOptions(patch: EmuOptionsPatch): Promise<EmuOptions>
    /** emulators found on this PC for a system */
    emulatorOptions(es: string): Promise<EmuEmulatorOption[]>
    setSystem(es: string, change: { enabled?: boolean; emulator?: EmuEmulatorOption }): Promise<EmuOptions>
    /** game with several versions (regions): which one to show and play; null = automatic */
    chooseVersion(gameId: string, versionId: string | null): Promise<Prefs>
  }
  jobs: {
    get(): Promise<JobsSnapshot>
    cancel(jobId: string): Promise<EmuActionResult>
    onChange(cb: (j: JobsSnapshot) => void): () => void
  }
  /** self-update from GitHub releases (verified: SHA-256 + Lumen release signature) */
  update: {
    get(): Promise<UpdateState>
    check(): Promise<UpdateState>
    download(): Promise<UpdateState>
    cancel(): Promise<void>
    /** close Lumen, swap the program, start it again */
    apply(): Promise<UpdateState>
    onChange(cb: (s: UpdateState) => void): () => void
  }
  /** the Deck window (optional desktop interface) */
  deck: {
    /** the dock's menu at the mouse: open Lumen, switch Deck off, quit */
    menu(): void
    /** show / hide / move one tab (applied by the main process to the stored tabs) */
    group(op: DeckGroupOp): Promise<void>
    /** key and label of the screen Deck is on (its dimensions are stored per screen) */
    screen(): Promise<{ key: string; label: string }>
    /** one step of the dock / games panel width on one screen (the one shown in Settings) */
    setLayout(step: DeckLayoutStep): Promise<void>
    /** Deck page: open the games panel with this height of tiles, or close it (null) */
    expand(content: number | null): void
    /** Deck page: where the dock and the panel are in its window */
    onGeometry(cb: (g: DeckGeometry) => void): () => void
    getGeometry(): Promise<DeckGeometry | null>
  }
  /** desktop (Lumen look) ⇄ fullscreen (EmuStart look); both use the same core */
  ui: {
    getMode(): Promise<UiMode>
    setMode(mode: UiMode): Promise<void>
    /** the game the user is looking at (kept when switching modes) */
    select(gameId: string | null): void
    onMode(cb: (mode: UiMode, selection: string | null) => void): () => void
  }
  app: {
    toggleFullscreen(): Promise<boolean>
    isFullscreen(): Promise<boolean>
    cacheStats(): Promise<CacheStats>
    clearCache(): Promise<CacheStats>
    openLogs(): Promise<void>
    openExternal(url: string): Promise<void>
    /** read-only listing for the in-app path picker ('' = shortcuts and drives) */
    listDir(dir: string, o: FsListOptions): Promise<FsListing>
    quit(): Promise<void>
    onFocusChange(cb: (focused: boolean) => void): () => void
    /** XInput controller state from the main process (see main/input/xinput.ts) */
    onPadState(cb: (pads: PadState[]) => void): () => void
    platform: string
  }
}

export const IPC = {
  libraryGet: 'library:get',
  libraryRatings: 'library:ratings',
  libraryFacts: 'library:facts',
  libraryRefresh: 'library:refresh',
  librarySnapshot: 'library:snapshot',
  gamePlay: 'game:play',
  gameInstall: 'game:install',
  gameOpen: 'game:open',
  gameDetails: 'game:details',
  prefsGet: 'prefs:get',
  prefsOp: 'prefs:op',
  prefsChanged: 'prefs:changed',
  settingsGet: 'settings:get',
  settingsPatch: 'settings:patch',
  settingsSecret: 'settings:secret',
  settingsChanged: 'settings:changed',
  artOptions: 'art:options',
  artSearch: 'art:search',
  artSetMatch: 'art:setMatch',
  artChoose: 'art:choose',
  artLbOptions: 'art:lbOptions',
  artChooseLb: 'art:chooseLb',
  artUseFile: 'art:useFile',
  artUseSteam: 'art:useSteam',
  artUserGallery: 'art:userGallery',
  artChooseUser: 'art:chooseUser',
  artOwnOptions: 'art:ownOptions',
  artKeysImport: 'art:keysImport',
  artKeysExport: 'art:keysExport',
  artChooseOwn: 'art:chooseOwn',
  artReset: 'art:reset',
  artChanged: 'art:changed',
  appFullscreen: 'app:fullscreen',
  appIsFullscreen: 'app:isFullscreen',
  appCacheStats: 'app:cacheStats',
  appClearCache: 'app:clearCache',
  appOpenLogs: 'app:openLogs',
  appOpenExternal: 'app:openExternal',
  appQuit: 'app:quit',
  deckMenu: 'deck:menu',
  deckGroup: 'deck:group',
  deckScreen: 'deck:screen',
  deckLayout: 'deck:layout',
  deckExpand: 'deck:expand',
  deckGeometry: 'deck:geometry',
  deckGetGeometry: 'deck:getGeometry',
  appListDir: 'app:listDir',
  appFocus: 'app:focus',
  launchboxStatus: 'launchbox:status',
  launchboxUpdate: 'launchbox:update',
  launchboxCancel: 'launchbox:cancel',
  launchboxChanged: 'launchbox:changed',
  launchboxTitle: 'launchbox:title',
  launchboxSetTitle: 'launchbox:setTitle',
  padState: 'pad:state',
  emuLaunch: 'emu:launch',
  emuSaves: 'emu:saves',
  emuGameOptions: 'emu:gameOptions',
  emuAccount: 'emu:account',
  emuSystemLogos: 'emu:systemLogos',
  emuSetVariant: 'emu:setVariant',
  emuSetGameEmulator: 'emu:setGameEmulator',
  emuConfigure: 'emu:configure',
  emuSettingsHistory: 'emu:settingsHistory',
  emuSettingsRestore: 'emu:settingsRestore',
  emuShaderOff: 'emu:shaderOff',
  emuMetaSave: 'emu:metaSave',
  emuMetaFetch: 'emu:metaFetch',
  emuServerArt: 'emu:serverArt',
  emuServerArtChoose: 'emu:serverArtChoose',
  emuServerArtClear: 'emu:serverArtClear',
  emuSystemInfo: 'emu:systemInfo',
  emuPlayOtherCore: 'emu:playOtherCore',
  emuCopyState: 'emu:copyState',
  emuSlotSet: 'emu:slotSet',
  emuStateEditInfo: 'emu:stateEditInfo',
  emuStateEdit: 'emu:stateEdit',
  emuStateTrash: 'emu:stateTrash',
  emuSyncProgress: 'emu:syncProgress',
  emuCancelLaunch: 'emu:cancelLaunch',
  emuDismiss: 'emu:dismiss',
  emuResolve: 'emu:resolveConflict',
  emuToggleKeep: 'emu:toggleKeep',
  emuRemoveLocal: 'emu:removeLocal',
  emuReadiness: 'emu:readiness',
  emuControllerKey: 'emu:controllerKey',
  emuInstall: 'emu:install',
  emuSettings: 'emu:settings',
  emuSetFolder: 'emu:setFolder',
  emuRefresh: 'emu:refresh',
  emuRestart: 'emu:restart',
  emuClearConflicts: 'emu:clearConflicts',
  emuChooseVersion: 'emu:chooseVersion',
  emuOptions: 'emu:options',
  emuSetOptions: 'emu:setOptions',
  emuEmulatorOptions: 'emu:emulatorOptions',
  emuSetSystem: 'emu:setSystem',
  gogOptions: 'gog:options',
  gogInstall: 'gog:install',
  gogResume: 'gog:resume',
  gogAddDlc: 'gog:addDlc',
  gogCancel: 'gog:cancel',
  gogVerify: 'gog:verify',
  gogLaunch: 'gog:launch',
  gogExtras: 'gog:extras',
  gogExtrasDownload: 'gog:extrasDownload',
  steamFamilyStatus: 'steam:familyStatus',
  steamFamilyLogin: 'steam:familyLogin',
  steamFamilyLogout: 'steam:familyLogout',
  gogSaves: 'gog:saves',
  gogSavesSet: 'gog:savesSet',
  gogSavesSync: 'gog:savesSync',
  gogSavesBackups: 'gog:savesBackups',
  gogSavesRestore: 'gog:savesRestore',
  gogPlayTasks: 'gog:playTasks',
  gogUninstall: 'gog:uninstall',
  gogFinishAdmin: 'gog:finishAdmin',
  gogInstallRuntimes: 'gog:installRuntimes',
  gogRefresh: 'gog:refresh',
  gogMessage: 'gog:message',
  jobsGet: 'jobs:get',
  jobsCancel: 'jobs:cancel',
  jobsChanged: 'jobs:changed',
  uiGetMode: 'ui:getMode',
  uiSetMode: 'ui:setMode',
  uiSelect: 'ui:select',
  uiMode: 'ui:mode',
  updateGet: 'update:get',
  updateCheck: 'update:check',
  updateDownload: 'update:download',
  updateCancel: 'update:cancel',
  updateApply: 'update:apply',
  updateChanged: 'update:changed'
} as const

export const ART_SCHEME = 'lumen-art'
/** EmuStart's fullscreen UI files (engine/web) and its /media, /assets proxied to the engine */
