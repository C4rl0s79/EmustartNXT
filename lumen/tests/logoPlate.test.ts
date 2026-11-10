import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { themeById } from '../src/renderer/src/tv/themes'

const css = (name: string): string => readFileSync(new URL(`../src/renderer/src/tv/theme-css/${name}.css`, import.meta.url), 'utf8')

describe('platform logos: the original logo on the theme\'s plate', () => {
  it('Kronika and Horyzont put logos on a plate; EmuStart shows them as they are', () => {
    expect(themeById('fantasy').logoPlate).toBe(true)
    expect(themeById('sf').logoPlate).toBe(true)
    expect(themeById('emustart').logoPlate).toBeUndefined()
  })
  it('each plate theme names its own plate image and the logo area', () => {
    for (const [name, img] of [['fantasy', 'kronika-plate.webp'], ['sf', 'horyzont-plate.webp']]) {
      const c = css(name)
      expect(c).toContain(`./assets/${img}`)
      for (const v of ['--tv-plate-ar', '--tv-plate-lw', '--tv-plate-lh']) expect(c).toContain(v)
    }
  })
})
