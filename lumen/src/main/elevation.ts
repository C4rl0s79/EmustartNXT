import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { shell } from 'electron'
import { EXPLORER, FLTMC, SCHTASKS } from './systemTools'
import { log } from './logger'

/**
 * Lumen „jako administrator” (Lumen.exe z manifestem requireAdministrator — jedno okno UAC przy starcie): kroki
 * instalacji gier nie pytają o zgodę, a gry, Steam i przeglądarka startują BEZ uprawnień administratora (silnik —
 * emustart/unelevated.py; tutaj — adresy przez powłokę). Autostart: zadanie Harmonogramu z najwyższymi
 * uprawnieniami i opóźnieniem po zalogowaniu (wpis Run nie uruchomi programu wymagającego administratora).
 */

let elevatedCache: boolean | null = null

/** Czy Lumen ma uprawnienia administratora (fltmc.exe kończy się kodem 0 tylko wtedy). */
export function isElevated(): boolean {
  if (elevatedCache === null) {
    if (process.platform !== 'win32') return (elevatedCache = false)
    try {
      execFileSync(FLTMC, [], { stdio: 'ignore', windowsHide: true, timeout: 5000 })
      elevatedCache = true
    } catch {
      elevatedCache = false
    }
  }
  return elevatedCache
}

/** for tests */
export function setElevatedForTests(v: boolean | null): void {
  elevatedCache = v
}

/**
 * Adres (steam://…, https://…) — z uprawnieniami przez Eksploratora: przekazuje go działającej powłoce, więc Steam
 * i przeglądarka startują bez uprawnień administratora; bez uprawnień — jak dotąd shell.openExternal.
 */
export async function openUnelevated(target: string): Promise<void> {
  if (isElevated()) {
    spawn(EXPLORER, [target], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    return
  }
  await shell.openExternal(target)
}

export const AUTOSTART_TASK = 'Lumen autostart'
/** sekundy po zalogowaniu — sieć (np. Tailscale) zdąży się połączyć, zanim Lumen poprosi serwer o bibliotekę */
export const AUTOSTART_DELAY_S = 30

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const quoteArg = (a: string): string => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)

/** XML zadania: przy logowaniu TEGO użytkownika, z opóźnieniem, najwyższe uprawnienia, bez limitu czasu, na baterii też. */
export function autostartTaskXml(exe: string, args: string[], user: string, delayS = AUTOSTART_DELAY_S): string {
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Lumen: start z Windows (jako administrator, ${delayS} s po zalogowaniu)</Description></RegistrationInfo>
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled><UserId>${esc(user)}</UserId><Delay>PT${Math.max(0, Math.round(delayS))}S</Delay></LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author"><UserId>${esc(user)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>HighestAvailable</RunLevel></Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec><Command>${esc(exe)}</Command><Arguments>${esc(args.map(quoteArg).join(' '))}</Arguments><WorkingDirectory>${esc(path.dirname(exe))}</WorkingDirectory></Exec>
  </Actions>
</Task>
`
}

const currentUser = (): string => `${process.env.USERDOMAIN || os.hostname()}\\${process.env.USERNAME || os.userInfo().username}`

/** Zadanie autostartu istnieje (i wskazuje ten Lumen.exe — `exe` podany: inny folder = nieaktualne). */
export function autostartTaskExists(exe?: string): boolean {
  try {
    const xml = execFileSync(SCHTASKS, ['/Query', '/TN', AUTOSTART_TASK, '/XML'], { windowsHide: true, timeout: 15000 })
    const text = xml.includes(0) ? xml.toString('utf16le') : xml.toString('utf8')
    return !exe || text.toLowerCase().includes(esc(exe).toLowerCase())
  } catch {
    return false
  }
}

/** Włącza / wyłącza autostart przez Harmonogram zadań; false — Windows odmówił (zasady, brak uprawnień). */
export function setAutostartTask(on: boolean, exe: string, args: string[], delayS = AUTOSTART_DELAY_S): boolean {
  try {
    if (!on) {
      if (autostartTaskExists()) execFileSync(SCHTASKS, ['/Delete', '/TN', AUTOSTART_TASK, '/F'], { windowsHide: true, timeout: 15000 })
      return true
    }
    const dir = mkdtempSync(path.join(os.tmpdir(), 'lumen-task-'))
    try {
      const file = path.join(dir, 'autostart.xml')
      // Harmonogram czyta XML zadania w UTF-16 (z BOM)
      writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(autostartTaskXml(exe, args, currentUser(), delayS), 'utf16le')]))
      execFileSync(SCHTASKS, ['/Create', '/F', '/TN', AUTOSTART_TASK, '/XML', file], { windowsHide: true, timeout: 15000 })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    return true
  } catch (e) {
    log.error('deck', `start with Windows (Harmonogram zadań): ${(e as Error).message}`)
    return false
  }
}
