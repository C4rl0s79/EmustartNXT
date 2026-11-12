import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isElevated } from './elevation'
import { POWERSHELL } from './systemTools'

/**
 * Dwie kopie Lumena (np. wersja testowa przy zainstalowanej, schowanej w zasobniku): druga kopia przekazuje
 * działającej swoją wersję, Lumen.exe i argumenty, a działająca pyta gracza, która ma zostać. Ta sama kopia
 * uruchomiona ponownie — tylko przywraca okno.
 *
 * Przez pliki w %LOCALAPPDATA%\Lumen, nie przez blokadę jednej kopii Electrona: ta rozpoznaje kopie po ścieżce
 * folderu danych (dwie ścieżki do jednego folderu — blokada zajęta, a powiadomienie nie dochodzi; osobne foldery
 * danych — obie kopie działają naraz), a jej komunikat od procesu bez uprawnień do procesu administratora Windows
 * odrzuca. Działająca kopia zapisuje `running.json` (wersja, Lumen.exe, PID) i odbiera `second-instance.json`;
 * nowa kopia — zanim ruszy dane — zostawia prośbę i czeka, aż działająca ją odbierze.
 */
export interface LumenInstance {
  version: string
  exe: string
  /** argumenty startu bez samego programu (z kodu źródłowego — z folderem aplikacji) */
  args: string[]
}

export function asInstance(data: unknown): LumenInstance | null {
  const d = data as Partial<LumenInstance> | null
  if (!d || typeof d.version !== 'string' || typeof d.exe !== 'string' || !d.exe) return null
  return { version: d.version, exe: d.exe, args: Array.isArray(d.args) ? d.args.filter((a): a is string => typeof a === 'string') : [] }
}

const samePath = (a: string, b: string): boolean => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()

/** Inna kopia: inny Lumen.exe albo inna wersja (np. zaktualizowana w miejscu, a stara jeszcze działa). */
export function isOtherCopy(running: LumenInstance, incoming: LumenInstance): boolean {
  return !samePath(running.exe, incoming.exe) || running.version !== incoming.version
}

export function conflictMessage(running: LumenInstance, incoming: LumenInstance): { message: string; detail: string; buttons: string[] } {
  return {
    message: 'Uruchomiono drugą kopię Lumena. Która ma zostać?',
    detail: `Działa: Lumen ${running.version} — ${path.dirname(running.exe)}\nNowa: Lumen ${incoming.version} — ${path.dirname(incoming.exe)}`,
    buttons: [`Zostaw działającą (${running.version})`, `Przełącz na nową (${incoming.version})`]
  }
}

const psQuote = (s: string): string => `'${s.replace(/'/g, "''")}'`

/** Polecenie PowerShell uruchamiające kopię przez powłokę (manifest „jako administrator” — okno UAC). */
export function startProcessCommand(it: LumenInstance): string {
  // Start-Process łączy argumenty spacjami — te ze spacją w cudzysłowie
  const args = it.args.map((a) => (/\s/.test(a) ? `"${a}"` : a))
  return `Start-Process -FilePath ${psQuote(it.exe)} -WorkingDirectory ${psQuote(path.dirname(it.exe))}${args.length ? ` -ArgumentList ${args.map(psQuote).join(',')}` : ''}`
}

/** Uruchamia wybraną kopię (po zwolnieniu blokady jednej kopii): z uprawnieniami — wprost (bez okna UAC),
 *  bez nich — przez powłokę, która w razie potrzeby pokaże okno UAC. */
export function launchInstance(it: LumenInstance): void {
  if (isElevated()) {
    spawn(it.exe, it.args, { cwd: path.dirname(it.exe), detached: true, stdio: 'ignore' }).unref()
    return
  }
  spawn(POWERSHELL, ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', startProcessCommand(it)], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  }).unref()
}

export const INSTANCE_DIR = path.join(process.env.LOCALAPPDATA || os.homedir(), 'Lumen')
const RUNNING = 'running.json'
const REQUEST = 'second-instance.json'
/** tyle nowa kopia czeka na odebranie prośby — dłużej: działająca nie odpowiada (zawieszona, plik po awarii) */
export const HANDOFF_WAIT_MS = 4000
const POLL_MS = 500

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function writeAtomic(file: string, data: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(data))
  renameSync(tmp, file)
}

/** proces istnieje (EPERM — istnieje, ale z uprawnieniami administratora) */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

const sleep = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Nowa kopia, przed wyborem folderu danych: działa inna kopia Lumena — prośba do niej (ona pokaże okno albo
 * przywróci swoje) i true (ta się zamyka). False — nikt nie działa albo nie odebrał prośby (start jak dotąd).
 */
export function handOffToRunning(self: LumenInstance, dir = INSTANCE_DIR, waitMs = HANDOFF_WAIT_MS): boolean {
  const running = readJson(path.join(dir, RUNNING)) as { pid?: unknown } | null
  const pid = typeof running?.pid === 'number' ? running.pid : 0
  if (!pid || pid === process.pid || !processAlive(pid)) return false
  const req = path.join(dir, REQUEST)
  try {
    writeAtomic(req, self)
  } catch {
    return false
  }
  for (let t = 0; t < waitMs; t += 100) {
    sleep(100)
    if (!existsSync(req)) return true
  }
  rmSync(req, { force: true })
  return false
}

/**
 * Działająca kopia: zapisuje się w running.json i co pół sekundy odbiera prośby nowych kopii. Zwraca funkcję
 * wyrejestrowania (przy zamykaniu — PRZED uruchomieniem wybranej kopii, inaczej ta oddałaby prośbę z powrotem).
 */
export function registerRunning(self: LumenInstance, onOther: (other: LumenInstance) => void, dir = INSTANCE_DIR): () => void {
  const file = path.join(dir, RUNNING)
  const req = path.join(dir, REQUEST)
  try {
    writeAtomic(file, { ...self, pid: process.pid })
  } catch {
    return () => undefined
  }
  const timer = setInterval(() => {
    if (!existsSync(req)) return
    const other = asInstance(readJson(req))
    rmSync(req, { force: true })
    if (other) onOther(other)
  }, POLL_MS)
  timer.unref?.()
  return () => {
    clearInterval(timer)
    const r = readJson(file) as { pid?: unknown } | null
    if (r?.pid === process.pid) rmSync(file, { force: true })
  }
}
