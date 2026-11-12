import { describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as ins from '../src/main/instances'

// Dwie kopie Lumena: działająca pyta, która ma zostać (wersja i folder obu) — i niczego nie uruchamia
const installed = { version: '1.0.57', exe: 'D:\\SeamStart\\Lumen.exe', pid: 111 }
const test = { version: '1.0.59', exe: 'D:\\LumenTest\\Lumen.exe', pid: process.pid }
const tmp = (): string => mkdtempSync(path.join(os.tmpdir(), 'lumen-inst-'))
const fast = { handoff: 1500, answer: 5000, exit: 5000 }

describe('druga kopia Lumena', () => {
  it('ta sama kopia (inna wielkość liter w ścieżce) — bez okna; inny folder albo inna wersja — okno', () => {
    expect(ins.isOtherCopy(installed, { ...installed, exe: 'd:\\seamstart\\lumen.exe' })).toBe(false)
    expect(ins.isOtherCopy(installed, test)).toBe(true)
    expect(ins.isOtherCopy(installed, { ...installed, version: '1.0.58' })).toBe(true)
  })

  it('prośba z pliku — sprawdzona i przycięta (może ją zapisać każdy proces użytkownika)', () => {
    expect(ins.asInstance(undefined)).toBeNull()
    expect(ins.asInstance({ version: '1', exe: 'x' })).toBeNull() // bez PID
    expect(ins.asInstance({ version: '1', exe: 'x', pid: -3 })).toBeNull()
    const long = ins.asInstance({ version: 'v'.repeat(100), exe: 'D:\\L\\Lumen.exe', pid: 5, args: ['--evil'] })
    expect(long).toEqual({ version: `${'v'.repeat(40)}…`, exe: 'D:\\L\\Lumen.exe', pid: 5 })
  })

  it('okno: wersja i folder obu kopii, domyślnie zostaje działająca', () => {
    const m = ins.conflictMessage(installed, test)
    expect(m.detail).toBe('Działa: Lumen 1.0.57 — D:\\SeamStart\nNowa: Lumen 1.0.59 — D:\\LumenTest')
    expect(m.buttons).toEqual(['Zostaw działającą (1.0.57)', 'Przełącz na nową (1.0.59)'])
  })
})

/** „działająca kopia” w osobnym procesie: running.json, odbiór prośby, odpowiedź; przy „switch” — koniec procesu */
function fakeRunning(dir: string, answer: 'stay' | 'switch' | 'none'): Promise<{ got: () => unknown; kill: () => void }> {
  const code = `
const fs = require('fs'), path = require('path'); const dir = ${JSON.stringify(dir)}
fs.writeFileSync(path.join(dir, 'running.json'), JSON.stringify({ pid: process.pid }))
setInterval(() => {
  const req = path.join(dir, 'second-instance.json'); if (!fs.existsSync(req)) return
  const r = JSON.parse(fs.readFileSync(req, 'utf8')); fs.writeFileSync(path.join(dir, 'got.json'), JSON.stringify(r)); fs.rmSync(req)
  if (${JSON.stringify(answer)} === 'none') return
  fs.writeFileSync(path.join(dir, 'second-instance-' + r.pid + '.answer'), JSON.stringify(${JSON.stringify(answer)}))
  if (${JSON.stringify(answer)} === 'switch') setTimeout(() => process.exit(0), 300)
}, 50)`
  const p = spawn(process.execPath, ['-e', code], { stdio: 'ignore' })
  return new Promise((resolve) => {
    const t = setInterval(() => {
      if (!existsSync(path.join(dir, 'running.json'))) return
      clearInterval(t)
      resolve({ got: () => JSON.parse(readFileSync(path.join(dir, 'got.json'), 'utf8')), kill: () => p.kill() })
    }, 20)
  })
}

describe('prośba nowej kopii przez pliki (%LOCALAPPDATA%\\Lumen)', () => {
  it('nikt nie działa / plik po awarii (martwy PID) — start jak dotąd', () => {
    const dir = tmp()
    expect(ins.handOffToRunning(test, dir, fast)).toBe('continue')
    writeFileSync(path.join(dir, 'running.json'), JSON.stringify({ pid: 0x7ffffff0 }))
    expect(ins.handOffToRunning(test, dir, fast)).toBe('continue')
    expect(existsSync(path.join(dir, 'second-instance.json'))).toBe(false)
  })

  it('działająca nie odbiera prośby — po czasie start jak dotąd, prośba usunięta', () => {
    const dir = tmp()
    writeFileSync(path.join(dir, 'running.json'), JSON.stringify({ pid: process.ppid }))
    expect(ins.handOffToRunning(test, dir, { ...fast, handoff: 300 })).toBe('continue')
    expect(existsSync(path.join(dir, 'second-instance.json'))).toBe(false)
  })

  it('„zostaw działającą” — nowa kopia się zamyka; działająca dostała wersję, Lumen.exe i PID', async () => {
    const dir = tmp()
    const r = await fakeRunning(dir, 'stay')
    try {
      expect(ins.handOffToRunning(test, dir, fast)).toBe('exit')
      expect(r.got()).toEqual(test)
    } finally {
      r.kill()
    }
  })

  it('„przełącz” — nowa kopia czeka na zamknięcie działającej i startuje sama', async () => {
    const dir = tmp()
    const r = await fakeRunning(dir, 'switch')
    const pid = (JSON.parse(readFileSync(path.join(dir, 'running.json'), 'utf8')) as { pid: number }).pid
    expect(ins.handOffToRunning(test, dir, fast)).toBe('continue')
    expect(ins.processAlive(pid)).toBe(false)
    r.kill()
  })

  it('działająca odbiera prośbę i odpisuje (okno — Promise); wyrejestrowanie usuwa running.json', async () => {
    const dir = tmp()
    const got: unknown[] = []
    const unregister = ins.registerRunning(installed, async (o): Promise<ins.Answer> => (got.push(o), 'switch'), dir)
    expect(JSON.parse(readFileSync(path.join(dir, 'running.json'), 'utf8'))).toEqual({ pid: 111 })
    writeFileSync(path.join(dir, 'second-instance.json'), JSON.stringify({ ...test, pid: 4242 }))
    await new Promise((r) => setTimeout(r, 800))
    expect(got).toEqual([{ ...test, pid: 4242 }])
    expect(JSON.parse(readFileSync(path.join(dir, 'second-instance-4242.answer'), 'utf8'))).toBe('switch')
    unregister()
    expect(existsSync(path.join(dir, 'running.json'))).toBe(false)
  })
})
