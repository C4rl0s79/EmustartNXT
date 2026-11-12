import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Dwie kopie Lumena (np. wersja testowa przy zainstalowanej, schowanej w zasobniku): nowa kopia przekazuje
 * działającej swoją wersję i Lumen.exe, a działająca pyta gracza, która ma zostać. Ta sama kopia uruchomiona
 * ponownie — tylko przywraca okno.
 *
 * Przez pliki w %LOCALAPPDATA%\Lumen, nie przez blokadę jednej kopii Electrona: ta rozpoznaje kopie po ścieżce
 * folderu danych (dwie ścieżki do jednego folderu — blokada zajęta, a powiadomienie nie dochodzi; osobne foldery
 * danych — obie kopie działają naraz), a jej komunikat od procesu bez uprawnień do procesu administratora Windows
 * odrzuca. Działająca kopia zapisuje `running.json` (PID) i odbiera prośby `second-instance.json`; nowa kopia —
 * zanim ruszy dane — zostawia prośbę i czeka na odpowiedź `second-instance-<PID>.answer`.
 *
 * Działająca kopia NICZEGO nie uruchamia: prośbę może zapisać każdy proces użytkownika, a Lumen ma uprawnienia
 * administratora (uruchomienie programu z prośby = obejście UAC). „Przełącz” = działająca się zamyka, a nowa —
 * uruchomiona przez gracza, z jego zgodą UAC — czeka na to i startuje sama. Fałszywa prośba może co najwyżej
 * pokazać okno wyboru.
 */
export interface LumenInstance {
  version: string
  exe: string
  pid: number
}

export type Answer = 'stay' | 'switch'

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s)

export function asInstance(data: unknown): LumenInstance | null {
  const d = data as Partial<LumenInstance> | null
  if (!d || typeof d.version !== 'string' || typeof d.exe !== 'string' || !d.exe || typeof d.pid !== 'number' || !Number.isInteger(d.pid) || d.pid <= 0) return null
  // tylko do pokazania w oknie — z pliku, który może zapisać każdy proces użytkownika
  return { version: clip(d.version, 40), exe: clip(d.exe, 400), pid: d.pid }
}

const samePath = (a: string, b: string): boolean => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()

/** Inna kopia: inny Lumen.exe albo inna wersja (np. zaktualizowana w miejscu, a stara jeszcze działa). */
export function isOtherCopy(running: Omit<LumenInstance, 'pid'>, incoming: Omit<LumenInstance, 'pid'>): boolean {
  return !samePath(running.exe, incoming.exe) || running.version !== incoming.version
}

export function conflictMessage(running: Omit<LumenInstance, 'pid'>, incoming: Omit<LumenInstance, 'pid'>): { message: string; detail: string; buttons: string[] } {
  return {
    message: 'Uruchomiono drugą kopię Lumena. Która ma zostać?',
    detail: `Działa: Lumen ${running.version} — ${path.dirname(running.exe)}\nNowa: Lumen ${incoming.version} — ${path.dirname(incoming.exe)}`,
    buttons: [`Zostaw działającą (${running.version})`, `Przełącz na nową (${incoming.version})`]
  }
}

export const INSTANCE_DIR = path.join(process.env.LOCALAPPDATA || os.homedir(), 'Lumen')
const RUNNING = 'running.json'
const REQUEST = 'second-instance.json'
const answerFile = (dir: string, pid: number): string => path.join(dir, `second-instance-${pid}.answer`)
/** tyle nowa kopia czeka na odebranie prośby — dłużej: działająca nie odpowiada (zawieszona, plik po awarii) */
export const HANDOFF_WAIT_MS = 4000
/** okno wyboru otwarte najdłużej tyle — potem nowa kopia się zamyka (działająca zostaje) */
export const ANSWER_WAIT_MS = 10 * 60_000
/** „przełącz”: działająca zamyka silnik (zapisy) — nowa czeka najdłużej tyle */
export const EXIT_WAIT_MS = 120_000
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

/** czeka (blokując — przed startem aplikacji), aż `done()`; false po czasie */
function waitFor(done: () => boolean, ms: number, step = 100): boolean {
  for (let t = 0; t < ms; t += step) {
    if (done()) return true
    sleep(step)
  }
  return done()
}

/**
 * Nowa kopia, przed wyborem folderu danych. 'continue' — nikt nie działa, nie odebrał prośby albo gracz wybrał
 * tę kopię (poprzednia już się zamknęła): start jak dotąd. 'exit' — zostaje działająca (ta się zamyka).
 */
export function handOffToRunning(self: LumenInstance, dir = INSTANCE_DIR, t = { handoff: HANDOFF_WAIT_MS, answer: ANSWER_WAIT_MS, exit: EXIT_WAIT_MS }): 'continue' | 'exit' {
  const running = readJson(path.join(dir, RUNNING)) as { pid?: unknown } | null
  const pid = typeof running?.pid === 'number' ? running.pid : 0
  if (!pid || pid === self.pid || !processAlive(pid)) return 'continue'
  const req = path.join(dir, REQUEST)
  const ans = answerFile(dir, self.pid)
  try {
    rmSync(ans, { force: true })
    writeAtomic(req, self)
  } catch {
    return 'continue'
  }
  if (!waitFor(() => !existsSync(req), t.handoff)) {
    rmSync(req, { force: true })
    return 'continue'
  }
  let answer: unknown = null
  waitFor(() => (answer = readJson(ans)) !== null || !processAlive(pid), t.answer, 200)
  rmSync(ans, { force: true })
  if (answer === null) return processAlive(pid) ? 'exit' : 'continue' // działająca zniknęła bez odpowiedzi — start
  if (answer !== 'switch') return 'exit'
  waitFor(() => !processAlive(pid), t.exit, 200)
  return 'continue'
}

/**
 * Działająca kopia: zapisuje się w running.json i co pół sekundy odbiera prośby nowych kopii; `onOther` zwraca
 * odpowiedź (od razu albo po oknie wyboru). Zwraca funkcję wyrejestrowania (przy zamykaniu).
 */
export function registerRunning(
  self: LumenInstance,
  onOther: (other: LumenInstance) => Answer | Promise<Answer>,
  dir = INSTANCE_DIR
): () => void {
  const file = path.join(dir, RUNNING)
  const req = path.join(dir, REQUEST)
  try {
    writeAtomic(file, { pid: self.pid })
  } catch {
    return () => undefined
  }
  const timer = setInterval(() => {
    if (!existsSync(req)) return
    const other = asInstance(readJson(req))
    rmSync(req, { force: true })
    if (!other) return
    void Promise.resolve(onOther(other))
      .catch((): Answer => 'stay')
      .then((a) => {
        try {
          writeAtomic(answerFile(dir, other.pid), a)
        } catch {
          /* nowa kopia po czasie i tak się zamknie albo wystartuje */
        }
      })
  }, POLL_MS)
  timer.unref?.()
  return () => {
    clearInterval(timer)
    const r = readJson(file) as { pid?: unknown } | null
    if (r?.pid === self.pid) rmSync(file, { force: true })
  }
}
