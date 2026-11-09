import { describe, expect, it } from 'vitest'
import { gogGames, gogJobs, isGogId, type GogLibraryRaw, type GogStatusRaw } from '../src/main/gog/provider'

const build = { build_id: '777', version: '1.0', languages: ['en', 'pl'], dlcs: [{ id: '2001', name: 'Dodatek', has_files: true }], dependencies: ['MSVC2017'], size: 1000, hash: 'h1' }
const lib = (installs: GogLibraryRaw['installs'] = {}, games = [{ product_id: '1001', title: 'Testowa Gra', builds: [build] }]): GogLibraryRaw => ({ games, installs, fresh: true })
const status = (over: Partial<GogStatusRaw> = {}): GogStatusRaw => ({ jobs: [], last: {}, running: [], ...over })

describe('GOG library mapping', () => {
  it('stable id gog:<productId>, never a Steam appId', () => {
    const [g] = gogGames(lib(), status())
    expect(g.id).toBe('gog:1001')
    expect(g.appId).toBe(0)
    expect(g.source).toBe('gog')
    expect(g.installed).toBe(false)
    expect(g.gog).toMatchObject({ productId: '1001', state: 'notInstalled', onServer: true })
    expect(g.gog?.available?.dlcs).toEqual([{ id: '2001', name: 'Dodatek', hasFiles: true }])
    expect(isGogId('gog:1001')).toBe(true)
    expect(isGogId('gog:../x')).toBe(false)
  })

  it('installed only when the engine registry says installed (not because files exist)', () => {
    const inst = { product_id: '1001', title: 'Testowa Gra', state: 'needs_admin', build_id: '777', hash: 'h1', install_dir: 'D:\\G\\T', admin_steps: 1 }
    const [g] = gogGames(lib({ '1001': inst }), status())
    expect(g.installed).toBe(false)
    expect(g.gog?.state).toBe('needs_admin')
    const [ok] = gogGames(lib({ '1001': { ...inst, state: 'installed', admin_steps: 0, last_played: 100 } }), status({ running: ['1001'] }))
    expect(ok.installed).toBe(true)
    expect(ok.running).toBe(true)
    expect(ok.lastPlayed).toBe(100)
  })

  it('a job in progress shows as installing; a newer server build gives an honest note, no update action', () => {
    const [g] = gogGames(lib(), status({ jobs: [{ product_id: '1001', kind: 'install', title: 'T', phase: 'download', label: 'Instalowanie', done: 1, total: 2, speed: 5, active: true, cancellable: true }] }))
    expect(g.gog?.state).toBe('installing')
    const [u] = gogGames(lib({ '1001': { product_id: '1001', title: 'T', state: 'installed', hash: 'stary' } }), status())
    expect(u.gog?.updateNote).toMatch(/nie jest jeszcze obsługiwana/)
  })

  it('installed game missing from the server stays in the library (offline)', () => {
    const [g] = gogGames(lib({ '9': { product_id: '9', title: 'Lokalna', state: 'installed' } }, [{ product_id: '9', title: 'Lokalna', builds: [], local_only: true } as never]), status())
    expect(g.installed).toBe(true)
    expect(g.gog?.onServer).toBe(false)
  })

  it('jobs in the shared list, cancellable, with progress', () => {
    const jobs = gogJobs(status({ jobs: [
      { product_id: '1001', kind: 'install', title: 'Testowa Gra', phase: 'download', label: 'Instalowanie z serwera', done: 10, total: 100, speed: 3, active: true, cancellable: true },
      { product_id: '1002', kind: 'dlc', title: 'Inna', phase: 'queued', label: 'W kolejce', done: 0, total: 0, speed: 0, active: false, cancellable: true }
    ] }))
    expect(jobs[0]).toMatchObject({ id: 'gog:1001:install', kind: 'gogInstall', source: 'gog', gameId: 'gog:1001', state: 'active', progress: { done: 10, total: 100 } })
    expect(jobs[1]).toMatchObject({ state: 'queued', phase: 'DLC — W kolejce', progress: undefined })
  })
})

describe('GOG description and art from the server', () => {
  it('provider exposes the catalog info of a game (offline copy included)', async () => {
    const { GogProvider } = await import('../src/main/gog/provider')
    const engine = { on: () => undefined, state: 'stopped' } as unknown as ConstructorParameters<typeof GogProvider>[0]
    const p = new GogProvider(engine, 'nie-istnieje.json')
    ;(p as unknown as { lib: GogLibraryRaw }).lib = lib({}, [
      { product_id: '1001', title: 'Testowa Gra', builds: [build], info: { description: 'Opis', lead: 'Krótko', tags: ['RPG'], art: ['grid', 'logo'] } }
    ] as GogLibraryRaw['games'])
    expect(p.info('gog:1001')).toMatchObject({ description: 'Opis', art: ['grid', 'logo'] })
    expect(p.info('gog:9')).toBeUndefined()
    expect(p.info('steam:1')).toBeUndefined()
  })
})

describe('GOG saves: engine results in Lumen shape', () => {
  it('conflict and status mapping', async () => {
    const { withConflict, savesStatus } = await import('../src/main/gog/ipc')
    const c = withConflict({ ok: false, reason: 'Konflikt', conflict: [{ kind: 'saves', template: '<winAppData>/x', server_revision: 4, server_device: 'PC', local_files: 2 }] })
    expect(c).toMatchObject({ ok: false, error: 'Konflikt', conflict: [{ kind: 'saves', template: '<winAppData>/x', serverRevision: 4, serverDevice: 'PC', localFiles: 2 }] })
    expect(withConflict({ ok: true, message: 'ok' })).toEqual({ ok: true, message: 'ok' })
    const s = savesStatus({ ok: true, enabled: true, source: 'ludusavi', sets: [{ id: 's1', kind: 'config', template: 't', folder: 'C:/x', files: 3, exists: true }], needs_registry: true, registry: [{ path: 'HKCU/x', kind: 'saves', reason: 'wymaga obsługi rejestru' }], last_sync: 5, pending: 1 })
    expect(s).toMatchObject({ ok: true, enabled: true, config: false, source: 'ludusavi', needsRegistry: true, lastSync: 5, pending: 1 })
    expect(s.sets[0]).toMatchObject({ kind: 'config', files: 3 })
    expect(savesStatus({ source: 'cokolwiek' }).source).toBe('none')
  })
})

describe('dodatki GOG i Family Sharing', () => {
  it('dodatki z katalogu serwera są w grze', () => {
    const [g] = gogGames(lib({}, [{ product_id: '1001', title: 'T', builds: [build], info: { extras: [{ id: 'a'.repeat(16), name: 'OST', type: 'audio', size: 5, default: true }] } }] as GogLibraryRaw['games']), status())
    expect(g.gog?.extras).toEqual([{ id: 'a'.repeat(16), name: 'OST', type: 'audio', size: 5, default: true }])
  })
  it('zadanie dodatków ma własną etykietę', () => {
    const [j] = gogJobs(status({ jobs: [{ product_id: '1', kind: 'extras', title: 'T', phase: 'download', label: 'Pobieranie', done: 1, total: 4, speed: 1, active: true, cancellable: true }] }))
    expect(j.phase).toBe('Dodatki — Pobieranie')
    expect(j.progress?.eta).toBe(3)
  })
  it('biblioteka rodzinna: tylko gry do grania, nigdy zamiast własnej kopii', async () => {
    const { parseFamilyApps } = await import('../src/main/steam/family')
    expect(parseFamilyApps({ response: { apps: [{ appid: 10, name: 'A', exclude_reason: 0 }, { appid: 11, name: 'B', exclude_reason: 3 }, { name: 'zla' }] } })).toEqual([{ appId: 10, name: 'A' }])
    expect(parseFamilyApps({})).toEqual([])
    const { mergeLibrary } = await import('../src/main/library/merge')
    const games = mergeLibrary({ manifests: [], owned: [{ appId: 1, name: 'Moja', playtimeMinutes: 0 }], family: [{ appId: 1, name: 'Moja' }, { appId: 2, name: 'Pożyczona' }], localStats: new Map(), showTools: false } as Parameters<typeof mergeLibrary>[0])
    expect(games.find((g) => g.appId === 1)?.familyShared).toBeUndefined()
    expect(games.find((g) => g.appId === 2)).toMatchObject({ familyShared: true, installed: false, id: 'steam:2' })
  })
})
