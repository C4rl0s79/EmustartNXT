import { existsSync } from 'node:fs'
import path from 'node:path'

// Windows tools by full path: Lumen may start with a PATH without System32 (Explorer, Task Scheduler, the updater),
// and a bare "powershell.exe" then fails silently. tests/systemTools.test.ts refuses a bare name in src/main.

const WINDOWS = process.env.SystemRoot || process.env.windir || 'C:\\Windows'
export const SYSTEM32 = path.join(WINDOWS, 'System32')
export const POWERSHELL = path.join(SYSTEM32, 'WindowsPowerShell', 'v1.0', 'powershell.exe')
export const SCHTASKS = path.join(SYSTEM32, 'schtasks.exe')
export const REG_EXE = path.join(SYSTEM32, 'reg.exe')
/** zwraca 0 tylko w procesie z uprawnieniami administratora — sprawdzenie, czy Lumen działa „jako administrator” */
export const FLTMC = path.join(SYSTEM32, 'fltmc.exe')
/** powłoka Windows: `explorer.exe <adres>` przekazuje adres działającej powłoce — program startuje bez uprawnień */
export const EXPLORER = path.join(WINDOWS, 'explorer.exe')

/** The python.org launcher: in the Windows folder for an all-users install, in LOCALAPPDATA for a per-user one; the
 *  bare name only when neither exists (then PATH is the last chance, and the engine reports it cannot start). */
export const PY_LAUNCHER = ((): string => {
  const local = process.env.LOCALAPPDATA
  const found = [path.join(WINDOWS, 'py.exe'), local && path.join(local, 'Programs', 'Python', 'Launcher', 'py.exe')].find(
    (p): p is string => !!p && existsSync(p)
  )
  return found ?? 'py'
})()
