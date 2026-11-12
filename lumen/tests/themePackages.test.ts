import { describe, expect, it } from 'vitest'
import type { ThemePackage } from '@shared/types'
import { allThemes, contrast, fromPackage, lookSpecFor, registerPkgFonts, themeById, THEMES } from '../src/renderer/src/tv/themes'
import { FONTS } from '../src/renderer/src/tv/look'
import { LAYER_ATTRS, LAYER_TAGS, layerSrc, layerValueOk } from '../src/renderer/src/lib/themeLayers'

// Motywy TV z paczek z serwera (etap 14c): na liście za wbudowanymi, ich czcionki, reguły dekoracji

const PKG: ThemePackage = {
  id: 'portal-nexus',
  name: 'Portal Nexus',
  description: '',
  author: 'Karol',
  version: '1.0',
  palette: { bg: '#05010f', text: '#f4ecff', dim: '#c5b4eb', accent: '#2de2ff', selText: '#05010f', selBg: '#2de2ff', panel: 'rgba(13,6,38,.82)' },
  games: { layout: 'coverflow', reflection: true },
  logoPlate: false,
  consoleBackdrop: true,
  ambient: 'none',
  locks: ['accent', 'bg'],
  fonts: { text: ['orbitron', 'nieznana', 'atkinson'], head: [] },
  fontFaces: [{ name: 'orbitron', file: 'assets/fonts/orbitron.woff2' }],
  animations: ['off', 'low', 'med', 'high'],
  categories: {},
  hasLayers: true,
  rev: '0123456789abcdef'
}

describe('motywy z paczek', () => {
  it('na liście za wbudowanymi; nieznany id — motyw domyślny', () => {
    const all = allThemes([PKG])
    expect(all.map((t) => t.id)).toEqual([...THEMES.map((t) => t.id), 'portal-nexus'])
    expect(themeById('portal-nexus', [PKG]).pkg).toBe(PKG)
    expect(themeById('portal-nexus', []).id).toBe('emustart') // paczka zniknęła z serwera
    // paczka nie zastąpi wbudowanego (serwer i tak takiej nie przyjmie)
    expect(allThemes([{ ...PKG, id: 'sf', name: 'Podróbka' }]).filter((t) => t.id === 'sf').map((t) => t.name)).toEqual(['Horyzont'])
  })

  it('opis motywu: układ, brak tła ruchomego, czcionki tylko znane albo z paczki', () => {
    const t = fromPackage(PKG)
    expect(t.games).toEqual({ layout: 'coverflow', reflection: true })
    expect(t.ambient).toBeUndefined()
    expect(t.fonts).toEqual({ text: ['orbitron', 'atkinson'], head: ['segoe', 'atkinson'] })
    expect(t.description).toContain('Karol')
    expect(contrast(t.palette!.text, t.palette!.bg)).toBeGreaterThanOrEqual(4.5)
  })

  it('czcionka z paczki trafia do edytora „Wygląd” z własną rodziną CSS; wbudowanej nie zastępuje', () => {
    registerPkgFonts(PKG)
    expect(FONTS.orbitron[1]).toContain("'lumen-portal-nexus-orbitron'")
    registerPkgFonts({ ...PKG, fontFaces: [{ name: 'segoe', file: 'assets/x.woff2' }] })
    expect(FONTS.segoe[0]).toBe('Segoe UI')
    const font = lookSpecFor(fromPackage(PKG)).find((r) => 'k' in r && r.k === 'font') as { opts: string[]; def: string }
    expect(font.opts).toEqual(['orbitron', 'atkinson'])
    expect(font.def).toBe('orbitron')
  })

  it('dekoracje: tylko dozwolone znaczniki / atrybuty, obrazy tylko z assets/ pakietu', () => {
    for (const bad of ['script', 'iframe', 'a', 'object', 'embed', 'style', 'link', 'foreignobject', 'image', 'use']) expect(LAYER_TAGS.has(bad), bad).toBe(false)
    for (const bad of ['style', 'onload', 'onclick', 'href', 'xlink:href', 'srcset']) expect(LAYER_ATTRS.has(bad), bad).toBe(false)
    expect(layerValueOk('img', 'src', 'assets/glow.png')).toBe(true)
    expect(layerValueOk('img', 'src', 'https://evil/x.png')).toBe(false)
    expect(layerValueOk('img', 'src', 'assets/../../secret.png')).toBe(false)
    expect(layerValueOk('div', 'src', 'assets/glow.png')).toBe(false)
    expect(layerValueOk('rect', 'fill', 'url(#grad)')).toBe(true)
    expect(layerValueOk('rect', 'fill', 'url(https://evil/x)')).toBe(false)
    expect(layerValueOk('div', 'class', 'javascript:alert(1)')).toBe(false)
    expect(layerSrc(PKG, 'assets/my glow.png')).toBe('lumen-theme://portal-nexus/assets/my%20glow.png?r=0123456789abcdef')
  })
})
