import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { ART_SCHEME, IPC, type LumenApi } from '../shared/api'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args) as Promise<T>

function subscribe<A extends unknown[]>(channel: string, cb: (...args: A) => void): () => void {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]): void => cb(...(args as A))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const prefsOp = (op: string, ...args: unknown[]) => invoke<never>(IPC.prefsOp, op, ...args)

const api: LumenApi = {
  library: {
    familyStatus: () => invoke(IPC.steamFamilyStatus),
    familyLogin: () => invoke(IPC.steamFamilyLogin),
    familyLogout: () => invoke(IPC.steamFamilyLogout),
    get: () => invoke(IPC.libraryGet),
    refresh: (includeAccount) => invoke(IPC.libraryRefresh, includeAccount),
    ratings: (ids) => invoke(IPC.libraryRatings, ids),
    facts: (ids) => invoke(IPC.libraryFacts, ids),
    onSnapshot: (cb) => subscribe(IPC.librarySnapshot, cb)
  },
  game: {
    play: (id) => invoke(IPC.gamePlay, id),
    install: (id) => invoke(IPC.gameInstall, id),
    openInSteam: (id, view) => invoke(IPC.gameOpen, id, view),
    details: (id, force) => invoke(IPC.gameDetails, id, force)
  },
  prefs: {
    get: () => invoke(IPC.prefsGet),
    toggleFavorite: (id) => prefsOp('toggleFavorite', id),
    setGameCategories: (id, cats) => prefsOp('setGameCategories', id, cats),
    createCategory: (name) => prefsOp('createCategory', name),
    renameCategory: (id, name) => prefsOp('renameCategory', id, name),
    deleteCategory: (id) => prefsOp('deleteCategory', id),
    setPinned: (id, pinned) => prefsOp('setPinned', id, pinned),
    moveCategory: (id, delta) => prefsOp('moveCategory', id, delta),
    setPlatformOverride: (id, value) => prefsOp('setPlatformOverride', id, value),
    setGroupPinned: (id, pinned) => prefsOp('setGroupPinned', id, pinned),
    moveGroupPin: (id, delta) => prefsOp('moveGroupPin', id, delta),
    onChange: (cb) => subscribe(IPC.prefsChanged, cb)
  },
  gog: {
    options: (id) => invoke(IPC.gogOptions, id),
    install: (id, req) => invoke(IPC.gogInstall, id, req),
    resume: (id) => invoke(IPC.gogResume, id),
    addDlc: (id, dlcs) => invoke(IPC.gogAddDlc, id, dlcs),
    cancel: (id) => invoke(IPC.gogCancel, id),
    verify: (id) => invoke(IPC.gogVerify, id),
    launch: (id, task, choice) => invoke(IPC.gogLaunch, id, task, choice),
    extras: (id) => invoke(IPC.gogExtras, id),
    extrasDownload: (id, ids) => invoke(IPC.gogExtrasDownload, id, ids),
    saves: (id, refresh) => invoke(IPC.gogSaves, id, refresh),
    savesSet: (id, opts) => invoke(IPC.gogSavesSet, id, opts),
    savesSync: (id, choice) => invoke(IPC.gogSavesSync, id, choice),
    savesBackups: (id) => invoke(IPC.gogSavesBackups, id),
    savesRestore: (id, backupId) => invoke(IPC.gogSavesRestore, id, backupId),
    playTasks: (id) => invoke(IPC.gogPlayTasks, id),
    uninstall: (id) => invoke(IPC.gogUninstall, id),
    finishAdmin: (id) => invoke(IPC.gogFinishAdmin, id),
    installRuntimes: (id) => invoke(IPC.gogInstallRuntimes, id),
    refresh: () => invoke(IPC.gogRefresh),
    onMessage: (cb) => subscribe(IPC.gogMessage, cb)
  },
  settings: {
    get: () => invoke(IPC.settingsGet),
    patch: (p) => invoke(IPC.settingsPatch, p),
    setSecret: (name, value) => invoke(IPC.settingsSecret, name, value),
    onChange: (cb) => subscribe(IPC.settingsChanged, cb)
  },
  art: {
    url: (gameId, kind, rev = 0, layout, thumb) => `${ART_SCHEME}://img/${encodeURIComponent(gameId)}/${kind}?r=${rev}${layout === 'tv' ? '&tv=1' : ''}${thumb ? '&thumb=1' : ''}`,
    options: (id, kind, page) => invoke(IPC.artOptions, id, kind, page),
    search: (term) => invoke(IPC.artSearch, term),
    setMatch: (id, g) => invoke(IPC.artSetMatch, id, g),
    choose: (id, kind, option, layout) => invoke(IPC.artChoose, id, kind, option, layout),
    userGallery: (id, kind) => invoke(IPC.artUserGallery, id, kind),
    chooseUser: (id, kind, sha, ext, layout) => invoke(IPC.artChooseUser, id, kind, sha, ext, layout),
    ownOptions: (id, kind) => invoke(IPC.artOwnOptions, id, kind),
    keysImport: (file, password) => invoke(IPC.artKeysImport, file, password),
    keysExport: (folder, password) => invoke(IPC.artKeysExport, folder, password),
    chooseOwn: (id, kind, url, layout) => invoke(IPC.artChooseOwn, id, kind, url, layout),
    launchboxOptions: (id, kind) => invoke(IPC.artLbOptions, id, kind),
    chooseLaunchbox: (id, kind, url, layout) => invoke(IPC.artChooseLb, id, kind, url, layout),
    useFile: (id, kind, file, layout) => invoke(IPC.artUseFile, id, kind, file, layout),
    useSteam: (id, kind, layout) => invoke(IPC.artUseSteam, id, kind, layout),
    reset: (id, kind, layout) => invoke(IPC.artReset, id, kind, layout),
    onChanged: (cb) => subscribe(IPC.artChanged, cb)
  },
  launchbox: {
    status: () => invoke(IPC.launchboxStatus),
    update: () => invoke(IPC.launchboxUpdate),
    cancel: () => invoke(IPC.launchboxCancel),
    onChange: (cb) => subscribe(IPC.launchboxChanged, cb),
    title: (id) => invoke(IPC.launchboxTitle, id),
    setTitle: (id, name) => invoke(IPC.launchboxSetTitle, id, name)
  },
  emustart: {
    launch: (id, state, takeover) => invoke(IPC.emuLaunch, id, state, takeover),
    saves: (id) => invoke(IPC.emuSaves, id),
    systemInfo: (es) => invoke(IPC.emuSystemInfo, es),
    gameOptions: (id) => invoke(IPC.emuGameOptions, id),
    account: (method, ...args) => invoke(IPC.emuAccount, method, args),
    systemLogos: (es) => invoke(IPC.emuSystemLogos, es),
    setVariant: (id, v) => invoke(IPC.emuSetVariant, id, v),
    setGameEmulator: (id, e) => invoke(IPC.emuSetGameEmulator, id, e),
    configureEmulator: (id) => invoke(IPC.emuConfigure, id),
    emuSettingsHistory: (id) => invoke(IPC.emuSettingsHistory, id),
    emuSettingsRestore: (id, h) => invoke(IPC.emuSettingsRestore, id, h),
    setShaderOff: (es, off) => invoke(IPC.emuShaderOff, es, off),
    metaSave: (id, edits) => invoke(IPC.emuMetaSave, id, edits),
    metaFetchFull: (id) => invoke(IPC.emuMetaFetch, id),
    serverArt: (id, kind, q) => invoke(IPC.emuServerArt, id, kind, q),
    serverArtChoose: (id, kind, url) => invoke(IPC.emuServerArtChoose, id, kind, url),
    serverArtClear: (id, kind) => invoke(IPC.emuServerArtClear, id, kind),
    playOtherCore: (id, core) => invoke(IPC.emuPlayOtherCore, id, core),
    copyState: (id, rel, platform, emu) => invoke(IPC.emuCopyState, id, rel, platform, emu),
    setSaveSlot: (id, slot) => invoke(IPC.emuSlotSet, id, slot),
    stateEditInfo: (id) => invoke(IPC.emuStateEditInfo, id),
    stateEdit: (id, op, arc, arg, core) => invoke(IPC.emuStateEdit, id, op, arc, arg, core),
    stateTrash: (id, core) => invoke(IPC.emuStateTrash, id, core),
    syncProgress: () => invoke(IPC.emuSyncProgress),
    cancelLaunch: () => invoke(IPC.emuCancelLaunch),
    dismiss: () => invoke(IPC.emuDismiss),
    resolveConflict: (choice) => invoke(IPC.emuResolve, choice),
    toggleKeep: (id) => invoke(IPC.emuToggleKeep, id),
    removeLocal: (id) => invoke(IPC.emuRemoveLocal, id),
    readiness: (id) => invoke(IPC.emuReadiness, id),
    controllerKey: (id) => invoke(IPC.emuControllerKey, id),
    installEmulators: (systems) => invoke(IPC.emuInstall, systems),
    settings: () => invoke(IPC.emuSettings),
    setFolder: (key, folder) => invoke(IPC.emuSetFolder, key, folder),
    refreshLibrary: () => invoke(IPC.emuRefresh),
    restartEngine: () => invoke(IPC.emuRestart),
    clearConflicts: () => invoke(IPC.emuClearConflicts),
    chooseVersion: (id, version) => invoke(IPC.emuChooseVersion, id, version),
    options: () => invoke(IPC.emuOptions),
    setOptions: (patch) => invoke(IPC.emuSetOptions, patch),
    emulatorOptions: (es) => invoke(IPC.emuEmulatorOptions, es),
    setSystem: (es, change) => invoke(IPC.emuSetSystem, es, change)
  },
  jobs: {
    get: () => invoke(IPC.jobsGet),
    cancel: (id) => invoke(IPC.jobsCancel, id),
    onChange: (cb) => subscribe(IPC.jobsChanged, cb)
  },
  update: {
    get: () => invoke(IPC.updateGet),
    check: () => invoke(IPC.updateCheck),
    download: () => invoke(IPC.updateDownload),
    cancel: () => invoke(IPC.updateCancel),
    apply: () => invoke(IPC.updateApply),
    onChange: (cb) => subscribe(IPC.updateChanged, cb)
  },
  deck: {
    menu: () => ipcRenderer.send(IPC.deckMenu),
    group: (op) => invoke(IPC.deckGroup, op),
    screen: () => invoke(IPC.deckScreen),
    setLayout: (step) => invoke(IPC.deckLayout, step)
  },
  ui: {
    getMode: () => invoke(IPC.uiGetMode),
    setMode: (mode) => invoke(IPC.uiSetMode, mode),
    select: (id) => ipcRenderer.send(IPC.uiSelect, id),
    onMode: (cb) => subscribe(IPC.uiMode, cb)
  },
  app: {
    toggleFullscreen: () => invoke(IPC.appFullscreen),
    isFullscreen: () => invoke(IPC.appIsFullscreen),
    cacheStats: () => invoke(IPC.appCacheStats),
    clearCache: () => invoke(IPC.appClearCache),
    openLogs: () => invoke(IPC.appOpenLogs),
    openExternal: (url) => invoke(IPC.appOpenExternal, url),
    listDir: (dir, o) => invoke(IPC.appListDir, dir, o),
    quit: () => invoke(IPC.appQuit),
    onFocusChange: (cb) => subscribe(IPC.appFocus, cb),
    onPadState: (cb) => subscribe(IPC.padState, cb),
    platform: process.platform
  }
}

contextBridge.exposeInMainWorld('lumen', api)
