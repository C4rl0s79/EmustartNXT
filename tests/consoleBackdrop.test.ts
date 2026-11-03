import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { emuSystem } from '../src/main/emustart/mapping'
import { themeById } from '../src/renderer/src/tv/themes'

// All data below is synthetic (no real library or server).

const css = (path: string): string => readFileSync(new URL(`../src/renderer/src/tv/${path}`, import.meta.url), 'utf8')
const sys = { es: 'ps2', display: 'PlayStation 2', games: 3, cached: 1, emulator: 'PCSX2' }

describe("console photo behind the system carousel", () => {
  it('the engine row carries the photo to the renderer: flag, credit and brightness', () => {
    const s = emuSystem({ ...sys, logo: '/media/_systems/ps2.png', console: '/media/_systems/ps2.console.webp?v=1', console_credit: 'Evan-Amos, Wikimedia Commons (Public domain)', console_lum: 0.18 })
    expect(s).toMatchObject({ hasLogo: true, hasConsole: true, consoleCredit: 'Evan-Amos, Wikimedia Commons (Public domain)', consoleLum: 0.18 })
    expect(s).not.toHaveProperty('console') // the media path stays in the main process (lumen-art: emusys:<es> / hero)
  })
  it('a new logo or console photo on the server is a new picture address (renderer image cache)', () => {
    const a = emuSystem({ ...sys, logo: '/media/_systems/ps2.png', console: '/media/_systems/ps2.console.webp?v=1' })
    const b = emuSystem({ ...sys, logo: '/media/_systems/ps2.png', console: '/media/_systems/ps2.console.webp?v=2' })
    const c = emuSystem({ ...sys, logo: '/media/_systems/ps2.custom.png?v=9', console: '/media/_systems/ps2.console.webp?v=1' })
    expect(a.mediaRev).toBeTypeOf('number')
    expect(new Set([a.mediaRev, b.mediaRev, c.mediaRev]).size).toBe(3)
    expect(emuSystem({ ...sys, logo: '/media/_systems/ps2.png', console: '/media/_systems/ps2.console.webp?v=1' }).mediaRev).toBe(a.mediaRev)
    expect(emuSystem(sys).mediaRev).toBeUndefined()
  })
  it('a platform without a photo (or an older engine without the field) has no console', () => {
    for (const row of [{ ...sys, console: '' }, sys]) {
      const s = emuSystem(row)
      expect(s.hasConsole).toBeUndefined()
      expect(s.consoleCredit).toBeUndefined()
    }
  })
  it('only Kronika and Horyzont show it; EmuStart stays as it is', () => {
    expect(themeById('fantasy').consoleBackdrop).toBe(true)
    expect(themeById('sf').consoleBackdrop).toBe(true)
    expect(themeById('emustart').consoleBackdrop).toBeUndefined()
  })
  it('each backdrop theme sets its own tone; the shared layer tones by the photo brightness', () => {
    for (const name of ['fantasy', 'sf']) {
      const c = css(`theme-css/${name}.css`)
      for (const v of ['--tv-con-filter', '--tv-con-op']) expect(c).toContain(v)
    }
    const base = css('tv.css')
    expect(base).toMatch(/\.tv-console \{[^}]*var\(--con-lum/)
    expect(base).toMatch(/\.tv-console img \{[^}]*object-fit: contain/)
  })
})
