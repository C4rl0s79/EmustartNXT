import path from 'node:path'
import { IPC } from '@shared/api'
import type { ActionResult, GogInstallRequest, GogOptionsResult, GogPlayTask, GogVerifyResult, Settings } from '@shared/types'
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
  handle(IPC.gogLaunch, async (gameId: string, task?: number) => {
    const t = typeof task === 'number' && Number.isInteger(task) && task >= 0 && task < 64 ? task : -1
    if (process.env.LUMEN_DRY_RUN === '1') return fail('Tryb testowy (LUMEN_DRY_RUN=1): uruchamianie gier jest wyłączone.')
    const r = await call<{ ok: boolean; reason?: string; message?: string }>('gog_launch', [pidOf(gameId), t])
    if (r.ok) ctx.launched(gameId)
    void gog.refresh(false)
    return result(r)
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
