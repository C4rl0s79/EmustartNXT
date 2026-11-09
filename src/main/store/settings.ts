import { safeStorage } from 'electron'
import { homedir } from 'node:os'
import path from 'node:path'
import type { SecretName, Settings, SettingsPatch } from '@shared/types'
import { JsonFile } from './jsonFile'
import { log, registerSecret } from '../logger'
import { isValidSteamId64 } from '../steam/local'

type StoredSettings = Omit<Settings, 'hasSgdbKey' | 'hasSteamWebKey' | 'secretsEncrypted'>

const defaults = (): StoredSettings => ({
  version: 1,
  artPriority: 'sgdbFirst',
  afterLaunch: 'minimize',
  restoreAfterGame: true,
  startFullscreen: false,
  showTools: false,
  demoMode: false,
  gamepadBackend: 'xinput',
  startMode: 'desktop',
  regionOrder: 'europe',
  emustartEnabled: true,
  language: 'polish',
  tvTheme: 'emustart',
  tvLooks: {},
  gogInstallDir: defaultGogDir(),
  gogLanguages: ['pl', 'en']
})

/** future GOG installs go here (a subfolder per game); changing it never moves installed games */
export function defaultGogDir(): string {
  return path.join(homedir(), 'Games', 'GOG')
}

/** short language codes (pl, en, zh…), unique, at most 8 — the order is the preference */
export function cleanLangs(v: unknown): string[] {
  if (!Array.isArray(v)) return ['pl', 'en']
  return [...new Set(v.filter((x): x is string => typeof x === 'string').map((x) => x.trim().toLowerCase()).filter((x) => /^[a-z]{2,3}$/.test(x)))].slice(0, 8)
}

/** absolute folder path, or undefined */
export function cleanAbsDir(v: unknown): string | undefined {
  const p = cleanPath(v)
  return p && path.isAbsolute(p) && !/[<>"|?*\x00-\x1f]/.test(p.slice(2)) ? path.normalize(p) : undefined
}

/** per-theme looks: theme id → { key: number | short string } — anything else is dropped */
function cleanLooks(v: unknown): Record<string, Record<string, number | string>> {
  const out: Record<string, Record<string, number | string>> = {}
  if (!v || typeof v !== 'object') return out
  for (const [id, look] of Object.entries(v as Record<string, unknown>).slice(0, 20)) {
    if (!/^[a-z0-9-]{1,40}$/.test(id) || !look || typeof look !== 'object') continue
    const clean: Record<string, number | string> = {}
    for (const [k, x] of Object.entries(look as Record<string, unknown>).slice(0, 60)) {
      if (!/^[a-z_]{1,20}$/.test(k)) continue
      if (typeof x === 'number' && Number.isFinite(x)) clean[k] = x
      else if (typeof x === 'string' && x.length <= 40) clean[k] = x
    }
    out[id] = clean
  }
  return out
}

const cleanPath = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() && v.length < 1024 ? v.trim() : undefined)

function migrate(raw: unknown): StoredSettings {
  const d = defaults()
  if (!raw || typeof raw !== 'object') return d
  const r = raw as Partial<StoredSettings>
  return {
    ...d,
    steamIdOverride: typeof r.steamIdOverride === 'string' && isValidSteamId64(r.steamIdOverride) ? r.steamIdOverride : undefined,
    artPriority: r.artPriority === 'steamFirst' ? 'steamFirst' : 'sgdbFirst',
    afterLaunch: r.afterLaunch === 'keep' ? 'keep' : 'minimize',
    restoreAfterGame: r.restoreAfterGame !== false,
    startFullscreen: r.startFullscreen === true,
    showTools: r.showTools === true,
    demoMode: r.demoMode === true,
    gamepadBackend: r.gamepadBackend === 'chromium' ? 'chromium' : 'xinput',
    startMode: r.startMode === 'fullscreen' ? 'fullscreen' : 'desktop',
    regionOrder: r.regionOrder === 'usa' || r.regionOrder === 'japan' ? r.regionOrder : 'europe',
    emustartEnabled: r.emustartEnabled !== false,
    emustartHome: cleanPath(r.emustartHome),
    pythonPath: cleanPath(r.pythonPath),
    tvTheme: typeof r.tvTheme === 'string' && /^[a-z0-9-]{1,40}$/.test(r.tvTheme) ? r.tvTheme : 'emustart',
    tvLooks: cleanLooks(r.tvLooks),
    gogInstallDir: cleanAbsDir(r.gogInstallDir) ?? d.gogInstallDir,
    gogLanguages: r.gogLanguages === undefined ? d.gogLanguages : cleanLangs(r.gogLanguages)
  }
}

/** Secrets are stored separately, encrypted with Windows DPAPI via Electron safeStorage when available. */
interface StoredSecrets {
  encrypted: boolean
  values: Partial<Record<SecretName, string>>
}

export class SettingsStore {
  private file: JsonFile<StoredSettings>
  private secretsFile: JsonFile<StoredSecrets>
  private value = defaults()
  private secrets: Partial<Record<SecretName, string>> = {}

  constructor(settingsPath: string, secretsPath: string) {
    this.file = new JsonFile(settingsPath, defaults, migrate)
    this.secretsFile = new JsonFile<StoredSecrets>(secretsPath, () => ({ encrypted: false, values: {} }))
  }

  async init(): Promise<void> {
    this.value = await this.file.load()
    const stored = await this.secretsFile.load()
    for (const [name, v] of Object.entries(stored.values ?? {}) as [SecretName, string][]) {
      if (!v) continue
      try {
        const plain = stored.encrypted ? safeStorage.decryptString(Buffer.from(v, 'base64')) : v
        this.secrets[name] = plain
        registerSecret(plain)
      } catch (e) {
        log.warn('settings', `Cannot decrypt secret ${name} (${(e as Error).message}); it must be entered again.`)
      }
    }
  }

  get(): Settings {
    return {
      ...this.value,
      hasSgdbKey: !!this.secrets.sgdbApiKey,
      hasSteamWebKey: !!this.secrets.steamWebApiKey,
      secretsEncrypted: safeStorage.isEncryptionAvailable(),
      ...this.runtime
    }
  }

  private runtime: Partial<Settings> = {}

  /** Facts about this PC reported alongside the settings (not persisted). */
  setRuntimeInfo(info: Partial<Settings>): void {
    this.runtime = { ...this.runtime, ...info }
  }

  async patch(p: SettingsPatch): Promise<Settings> {
    if (p.gogInstallDir !== undefined && !cleanAbsDir(p.gogInstallDir)) throw new Error('Podaj pełną ścieżkę folderu gier GOG (np. D:\\Gry\\GOG).')
    if (p.gogLanguages !== undefined && !cleanLangs(p.gogLanguages).length) throw new Error('Wybierz co najmniej jeden język.')
    if (p.steamIdOverride !== undefined && p.steamIdOverride !== '' && !isValidSteamId64(p.steamIdOverride))
      throw new Error('SteamID64 musi mieć 17 cyfr (np. 7656119…).')
    const next = migrate({ ...this.value, ...p, steamIdOverride: p.steamIdOverride === '' ? undefined : (p.steamIdOverride ?? this.value.steamIdOverride) })
    this.value = next
    await this.file.save(next)
    return this.get()
  }

  getSecret(name: SecretName): string | undefined {
    return this.secrets[name]
  }

  async setSecret(name: SecretName, value: string | null): Promise<void> {
    const clean = value?.trim()
    if (clean) {
      if (!/^[A-Za-z0-9-]{16,64}$/.test(clean)) throw new Error('Klucz ma nieprawidłowy format.')
      this.secrets[name] = clean
      registerSecret(clean)
    } else {
      delete this.secrets[name]
    }
    const encrypted = safeStorage.isEncryptionAvailable()
    const values: StoredSecrets['values'] = {}
    for (const [k, v] of Object.entries(this.secrets) as [SecretName, string][]) {
      values[k] = encrypted ? safeStorage.encryptString(v).toString('base64') : v
    }
    await this.secretsFile.save({ encrypted, values })
    log.info('settings', `Secret ${name} ${clean ? 'updated' : 'removed'}`)
  }
}
