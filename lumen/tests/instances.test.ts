import { describe, expect, it, vi, beforeEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Dwie kopie Lumena: działająca pyta, która ma zostać (wersja i folder obu)
const spawned: { cmd: string; args: string[] }[] = []
vi.mock('electron', () => ({ shell: { openExternal: async () => undefined } }))
vi.mock('node:child_process', async (orig) => ({
  ...(await orig<typeof import('node:child_process')>()),
  spawn: (cmd: string, args: string[]) => {
    spawned.push({ cmd, args })
    return { unref: () => undefined }
  }
}))

const ins = await import('../src/main/instances')
const el = await import('../src/main/elevation')
const { POWERSHELL } = await import('../src/main/systemTools')

const installed = { version: '1.0.57', exe: 'D:\\SeamStart\\Lumen.exe', args: ['--deck'] }
const test = { version: '1.0.59', exe: 'D:\\LumenTest\\Lumen.exe', args: [] }

describe('druga kopia Lumena', () => {
  beforeEach(() => {
    spawned.length = 0
  })

  it('ta sama kopia (inna wielkość liter w ścieżce) — bez okna; inny folder albo inna wersja — okno', () => {
    expect(ins.isOtherCopy(installed, { ...installed, exe: 'd:\\seamstart\\lumen.exe', args: [] })).toBe(false)
    expect(ins.isOtherCopy(installed, test)).toBe(true)
    expect(ins.isOtherCopy(installed, { ...installed, version: '1.0.58' })).toBe(true)
  })

  it('dane od drugiej kopii — sprawdzone (stara wersja nie przekazuje nic)', () => {
    expect(ins.asInstance(undefined)).toBeNull()
    expect(ins.asInstance({})).toBeNull()
    expect(ins.asInstance({ version: '1.0.59', exe: 'D:\\L\\Lumen.exe', args: ['--deck', 5] })).toEqual({ version: '1.0.59', exe: 'D:\\L\\Lumen.exe', args: ['--deck'] })
  })

  it('okno: wersja i folder obu kopii, domyślnie zostaje działająca', () => {
    const m = ins.conflictMessage(installed, test)
    expect(m.detail).toBe('Działa: Lumen 1.0.57 — D:\\SeamStart\nNowa: Lumen 1.0.59 — D:\\LumenTest')
    expect(m.buttons).toEqual(['Zostaw działającą (1.0.57)', 'Przełącz na nową (1.0.59)'])
  })

  it('z uprawnieniami — nowa kopia wprost, z jej argumentami', () => {
    el.setElevatedForTests(true)
    ins.launchInstance(installed)
    expect(spawned).toEqual([{ cmd: 'D:\\SeamStart\\Lumen.exe', args: ['--deck'] }])
  })

  it('bez uprawnień — przez powłokę (okno UAC), apostrofy i spacje w ścieżce', () => {
    el.setElevatedForTests(false)
    ins.launchInstance({ version: '1.0.59', exe: "D:\\Gry O'Neil\\Lumen.exe", args: ['D:\\src\\my app', '--deck'] })
    expect(spawned[0].cmd).toBe(POWERSHELL)
    expect(spawned[0].args.at(-1)).toBe(
      "Start-Process -FilePath 'D:\\Gry O''Neil\\Lumen.exe' -WorkingDirectory 'D:\\Gry O''Neil' -ArgumentList '\"D:\\src\\my app\"','--deck'"
    )
  })
})

describe('prośba nowej kopii przez pliki (%LOCALAPPDATA%\Lumen)', () => {
  const tmp = (): string => mkdtempSync(path.join(os.tmpdir(), 'lumen-inst-'))

  it('nikt nie działa / plik po awarii (martwy PID) — start jak dotąd', () => {
    const dir = tmp()
    expect(ins.handOffToRunning(test, dir, 300)).toBe(false)
    writeFileSync(path.join(dir, 'running.json'), JSON.stringify({ ...installed, pid: 0x7ffffff0 }))
    expect(ins.handOffToRunning(test, dir, 300)).toBe(false)
    expect(existsSync(path.join(dir, 'second-instance.json'))).toBe(false)
  })

  it('działająca nie odbiera prośby — po czasie start jak dotąd, prośba usunięta', () => {
    const dir = tmp()
    writeFileSync(path.join(dir, 'running.json'), JSON.stringify({ ...installed, pid: process.ppid }))
    expect(ins.handOffToRunning(test, dir, 300)).toBe(false)
    expect(existsSync(path.join(dir, 'second-instance.json'))).toBe(false)
  })

  it('działająca odbiera prośbę: dostaje wersję, Lumen.exe i argumenty nowej; wyrejestrowanie usuwa running.json', async () => {
    const dir = tmp()
    const got: unknown[] = []
    const unregister = ins.registerRunning(installed, (o) => got.push(o), dir)
    expect(JSON.parse(readFileSync(path.join(dir, 'running.json'), 'utf8'))).toEqual({ ...installed, pid: process.pid })
    // nowa kopia (inny proces) — tu: prośba zapisana wprost, odbiór w ciągu pół sekundy
    writeFileSync(path.join(dir, 'second-instance.json'), JSON.stringify(test))
    await new Promise((r) => setTimeout(r, 700))
    expect(got).toEqual([test])
    expect(existsSync(path.join(dir, 'second-instance.json'))).toBe(false)
    unregister()
    expect(existsSync(path.join(dir, 'running.json'))).toBe(false)
  })
})
