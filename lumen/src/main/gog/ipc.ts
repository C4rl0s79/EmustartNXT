import path from 'node:path'
import { IPC } from '@shared/api'
import type { ActionResult, GogExtra, GogExtrasResult, GogInstallRequest, GogLaunchResult, GogOptionsResult, GogPlayTask, GogSaveConflict, GogSavesStatus, GogVerifyResult, Settings } from '@shared/types'
import type { EmustartEngine } from '../emustart/engine'
import { gogPid, type GogProvider } from './provider'

type Handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => Promise<R> | R) => void

interface Ctx {
  engine: EmustartEngine
  gog: GogProvider
  settings: () => Settings
  /** a game was started (minimize, restore when it ends) */
  launched: (gameId: string) => void
}

const fail = (error: string): ActionResult => ({ ok: false, error })

/** engine answer {ok, message?, reason?} → ActionResult */
function result(r: { ok?: boolean; message?: string; reason?: string } | null | undefined, fallback = 'Gotowe'): ActionResult {
  return r?.ok ? { ok: true, message: r.message || fallback } : fail(r?.reason || 'Nie udało się.')
}

const LANG = /^[a-z]{2,3}$/
const DIGITS = /^\d{1,20}$/

/**
 * Renderer → GOG operations in the EmuStart engine. Only these calls exist (no generic engine access);
 * every argument is checked here, the game must be a GOG game of the library, and the install folder is
 * computed from Lumen's settings (the renderer cannot pass a path).
 */
export function registerGogIpc(handle: Handle, ctx: Ctx): void {
  const { engine, gog } = ctx
  const pidOf = (gameId: unknown): string => {
    const pid = typeof gameId === 'string' ? gogPid(gameId) : undefined
    if (!pid || !gog.game(gameId as string)) throw new Error('To nie jest gra GOG z biblioteki.')
    return pid
  }
  const ready = (): void => {
    if (engine.state !== 'ready') throw new Error(engine.message ?? 'Silnik EmuStart nie działa.')
  }
  const call = <T>(method: string, args: unknown[], timeout = 30_000): Promise<T> => {
    ready()
    return engine.call<T>(method, args, timeout)
  }

  handle(IPC.gogOptions, async (gameId: string): Promise<GogOptionsResult> => {
    const pid = pidOf(gameId)
    const s = ctx.settings()
    const r = await call<Record<string, unknown> & { ok: boolean; reason?: string }>('gog_options', [pid, s.gogInstallDir, s.gogLanguages], 60_000)
    if (!r.ok) return { ok: false, error: r.reason ?? 'Serwer nie udostępnia tej gry.' }
    const inst = r.installed as { state: string; dlcs: string[]; languages: string[] } | null | undefined
    return {
      ok: true,
      title: String(r.title ?? ''),
      buildId: String(r.build_id ?? ''),
      version: String((r.builds as { version?: string }[] | undefined)?.[0]?.version ?? ''),
      languages: (r.languages as string[]) ?? [],
      defaultLanguages: (r.default_languages as string[]) ?? [],
      dlcs: ((r.dlcs as { id: string; name: string; has_files: boolean }[]) ?? []).map((d) => ({ id: d.id, name: d.name, hasFiles: d.has_files })),
      dependencies: (r.dependencies as string[]) ?? [],
      size: Number(r.size ?? 0),
      target: String(r.target ?? ''),
      free: typeof r.free === 'number' ? r.free : null,
      installed: inst ? { state: inst.state as never, dlcs: inst.dlcs ?? [], languages: inst.languages ?? [] } : null,
      updateNote: (r.update_available as string) || undefined
    }
  })

  handle(IPC.gogInstall, async (gameId: string, req: GogInstallRequest): Promise<ActionResult> => {
    const pid = pidOf(gameId)
    const langs = Array.isArray(req?.languages) ? req.languages.filter((x) => typeof x === 'string' && LANG.test(x)) : []
    const dlcs = Array.isArray(req?.dlcs) ? req.dlcs.filter((x) => typeof x === 'string' && DIGITS.test(x)) : []
    const primary = typeof req?.primary === 'string' && LANG.test(req.primary) ? req.primary : langs[0]
    if (!langs.length) return fail('Wybierz co najmniej jeden język.')
    if (!langs.includes(primary)) return fail('Język główny musi być jednym z wybranych.')
    // folder from the engine's own answer for this game (shared GOG folder + archive folder name)
    const opts = await call<{ ok: boolean; reason?: string; target?: string; build_id?: string }>('gog_options', [pid, ctx.settings().gogInstallDir, []], 60_000)
    if (!opts.ok || !opts.target || !opts.build_id) return fail(opts.reason ?? 'Serwer nie udostępnia tej gry.')
    if (!path.isAbsolute(opts.target)) return fail('Ustaw folder gier GOG w Ustawieniach.')
    const r = await call<{ ok: boolean; reason?: string }>('gog_install', [pid, opts.build_id, langs, primary, dlcs, opts.target])
    return result(r, 'Instalacja dodana do zadań.')
  })

  handle(IPC.gogResume, async (gameId: string) => result(await call('gog_resume', [pidOf(gameId)]), 'Wznawiam instalację.'))
  handle(IPC.gogAddDlc, async (gameId: string, dlcs: string[]) => {
    const list = Array.isArray(dlcs) ? dlcs.filter((x) => typeof x === 'string' && DIGITS.test(x)) : []
    if (!list.length) return fail('Wybierz DLC.')
    return result(await call('gog_add_dlc', [pidOf(gameId), list]), 'Instalacja DLC dodana do zadań.')
  })
  handle(IPC.gogCancel, async (gameId: string) => result(await call('gog_cancel', [pidOf(gameId)]), 'Przerywam — postęp zostanie zapisany.'))
  handle(IPC.gogVerify, async (gameId: string): Promise<GogVerifyResult> => {
    const r = await call<{ ok: boolean; reason?: string; checked?: number; bad_count?: number; bad?: { path: string; why: string }[] }>('gog_verify', [pidOf(gameId)], 30 * 60_000)
    void gog.refresh(false)
    if (r.reason) return { ok: false, error: r.reason }
    return { ok: !r.bad_count, checked: r.checked, badCount: r.bad_count ?? 0, bad: r.bad }
  })
  handle(IPC.gogLaunch, async (gameId: string, task?: number, choice?: string) => {
    const t = typeof task === 'number' && Number.isInteger(task) && task >= 0 && task < 64 ? task : -1
    if (process.env.LUMEN_DRY_RUN === '1') return fail('Tryb testowy (LUMEN_DRY_RUN=1): uruchamianie gier jest wyłączone.')
    // saves are synced with the EmuStart server before the game (2 min: a large set over a slow link)
    const r = await call<RawLaunch>('gog_launch', [pidOf(gameId), t, saveChoice(choice)], 120_000)
    if (r.ok) ctx.launched(gameId)
    void gog.refresh(false)
    return withConflict(r)
  })
  handle(IPC.gogExtras, async (gameId: string): Promise<GogExtrasResult> => {
    const r = await call<{ items?: GogExtra[]; target?: string }>('gog_extras', [pidOf(gameId), ctx.settings().gogInstallDir])
    return { items: r.items ?? [], target: r.target ?? '' }
  })
  handle(IPC.gogExtrasDownload, async (gameId: string, ids: unknown) => {
    const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string' && /^[0-9a-f]{16}$/.test(x)).slice(0, 500) : []
    if (!list.length) return fail('Nie wybrano dodatków.')
    return result(await call<{ ok: boolean; reason?: string }>('gog_extras_download', [pidOf(gameId), list, ctx.settings().gogInstallDir]), 'Pobieranie dodatków — postęp na liście zadań.')
  })
  handle(IPC.gogSaves, async (gameId: string, refresh?: boolean): Promise<GogSavesStatus> => {
    const r = await call<Record<string, unknown>>('gog_saves', [pidOf(gameId), !!refresh], 60_000)
    return savesStatus(r)
  })
  handle(IPC.gogSavesSet, async (gameId: string, opts: unknown) => {
    const o = (opts && typeof opts === 'object' ? opts : {}) as Record<string, unknown>
    const clean: Record<string, unknown> = {}
    if (typeof o.enabled === 'boolean') clean.enabled = o.enabled
    if (typeof o.config === 'boolean') clean.config = o.config
    if (typeof o.pick === 'string') clean.pick = o.pick.slice(0, 300)
    if (o.rules === null) clean.rules = null
    else if (o.rules && typeof o.rules === 'object' && Array.isArray((o.rules as { files?: unknown }).files))
      clean.rules = {
        files: ((o.rules as { files: unknown[] }).files)
          .slice(0, 50)
          .map((f) => f as { path?: unknown; tags?: unknown })
          .filter((f) => typeof f.path === 'string')
          .map((f) => ({ path: String(f.path).slice(0, 1000), tags: Array.isArray(f.tags) ? f.tags.filter((x) => x === 'save' || x === 'config') : ['save'] }))
      }
    return result(await call<{ ok: boolean; reason?: string }>('gog_saves_set', [pidOf(gameId), clean]), 'Zapisano.')
  })
  handle(IPC.gogSavesSync, async (gameId: string, choice?: string) =>
    withConflict(await call<RawLaunch>('gog_saves_sync', [pidOf(gameId), saveChoice(choice)], 10 * 60_000))
  )
  handle(IPC.gogSavesBackups, async (gameId: string) => {
    const r = await call<{ ok: boolean; backups?: { id: string; sets: string[] }[] }>('gog_saves_backups', [pidOf(gameId)])
    return r.backups ?? []
  })
  handle(IPC.gogSavesRestore, async (gameId: string, backupId: string) => {
    if (typeof backupId !== 'string' || !/^\d{8}-\d{6}$/.test(backupId)) return fail('Zła kopia zapasowa.')
    return result(await call<{ ok: boolean; reason?: string; message?: string }>('gog_saves_restore', [pidOf(gameId), backupId], 5 * 60_000))
  })
  handle(IPC.gogPlayTasks, async (gameId: string): Promise<GogPlayTask[]> => {
    const r = await call<{ ok: boolean; tasks?: GogPlayTask[] }>('gog_play_tasks', [pidOf(gameId)])
    return r.ok ? (r.tasks ?? []) : []
  })
  handle(IPC.gogUninstall, async (gameId: string) => {
    const r = await call<{ ok: boolean; reason?: string; message?: string }>('gog_uninstall', [pidOf(gameId)], 10 * 60_000)
    void gog.refresh(false)
    return result(r, 'Usunięto grę.')
  })
  handle(IPC.gogFinishAdmin, async (gameId: string) => {
    // the engine shows Windows' UAC prompt — no timeout shorter than a person needs to read it
    const r = await call<{ ok: boolean; reason?: string; message?: string }>('gog_finish_admin', [pidOf(gameId)], 10 * 60_000)
    void gog.refresh(false)
    return result(r)
  })
  handle(IPC.gogInstallRuntimes, async (gameId: string) => {
    const r = await call<{ ok: boolean; reason?: string; message?: string }>('gog_install_runtimes', [pidOf(gameId)], 30 * 60_000)
    void gog.refresh(false)
    return result(r)
  })
  handle(IPC.gogRefresh, async () => {
    await gog.refresh(true)
    return { ok: true, message: gog.summary().error ? `Serwer niedostępny: ${gog.summary().error}` : 'Katalog GOG odświeżony.' } as ActionResult
  })
}

type RawLaunch = { ok: boolean; reason?: string; message?: string; conflict?: Record<string, unknown>[] }

const saveChoice = (c: unknown): string => (c === 'local' || c === 'remote' || c === 'skip' ? c : '')

/** engine result → ActionResult with the save conflict (if any) in Lumen's shape */
export function withConflict(r: RawLaunch): GogLaunchResult {
  if (r.ok) return { ok: true, message: r.message }
  const conflict: GogSaveConflict[] | undefined = r.conflict?.map((c) => ({
    kind: String(c.kind ?? ''),
    template: String(c.template ?? ''),
    serverRevision: Number(c.server_revision ?? 0),
    serverTime: Number(c.server_time ?? 0),
    serverDevice: String(c.server_device ?? ''),
    localTime: Number(c.local_time ?? 0),
    localFiles: Number(c.local_files ?? 0)
  }))
  return { ok: false, error: r.reason ?? 'Nie udało się.', ...(conflict ? { conflict } : {}) }
}

export function savesStatus(r: Record<string, unknown>): GogSavesStatus {
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
  return {
    ok: !!r.ok,
    reason: typeof r.reason === 'string' && r.reason ? r.reason : undefined,
    enabled: !!r.enabled,
    config: !!r.config,
    userRules: (r.user_rules as GogSavesStatus['userRules']) ?? null,
    pick: String(r.pick ?? ''),
    source: (['user', 'server', 'ludusavi', 'ambiguous', 'none'].includes(String(r.source)) ? r.source : 'none') as GogSavesStatus['source'],
    title: String(r.title ?? ''),
    version: String(r.version ?? ''),
    attribution: String(r.attribution ?? ''),
    candidates: arr<string>(r.candidates).map(String),
    offline: String(r.offline ?? ''),
    sets: arr<Record<string, unknown>>(r.sets).map((x) => ({
      id: String(x.id),
      kind: x.kind === 'config' ? 'config' : 'saves',
      template: String(x.template ?? ''),
      folder: String(x.folder ?? ''),
      pattern: String(x.pattern ?? ''),
      files: Number(x.files ?? 0),
      exists: !!x.exists,
      error: String(x.error ?? '')
    })),
    skipped: arr<{ path: string; kind: string; reason: string }>(r.skipped),
    registry: arr<{ path: string; kind: string; reason: string }>(r.registry),
    needsRegistry: !!r.needs_registry,
    profile: !!r.profile,
    running: !!r.running,
    lastSync: Number(r.last_sync ?? 0),
    pending: Number(r.pending ?? 0),
    last: (r.last as GogSavesStatus['last']) ?? {}
  }
}
