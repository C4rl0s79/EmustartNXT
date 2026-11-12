import { useEffect, useRef } from 'react'
import { THEME_SCHEME } from '@shared/api'
import { sanitizeLayers } from '../lib/themeLayers'
import { pkgFontFamily, registerPkgFonts, type TvTheme } from './themes'

// Motyw z paczki (etap 14): jego arkusz i czcionki w <head> (tylko na czas używania motywu) oraz dekoracje
// (layers.html, oczyszczone — lib/themeLayers.ts) w warstwie nad tłem. Wbudowane motywy — nic tu nie robią.

const url = (t: TvTheme, rel: string): string => `${THEME_SCHEME}://${t.pkg!.id}/${rel.split('/').map(encodeURIComponent).join('/')}?r=${t.pkg!.rev}`

export function TvThemeAssets({ theme }: { theme: TvTheme }) {
  const pkg = theme.pkg
  useEffect(() => {
    if (!pkg) return
    registerPkgFonts(pkg)
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = url(theme, 'theme.css')
    link.dataset.lumenTheme = pkg.id
    const faces = document.createElement('style')
    faces.dataset.lumenTheme = pkg.id
    faces.textContent = pkg.fontFaces
      .map((f) => `@font-face{font-family:${pkgFontFamily(pkg, f.name)};src:url("${url(theme, f.file)}") format("woff2");font-display:swap}`)
      .join('\n')
    document.head.append(faces, link)
    return () => {
      link.remove()
      faces.remove()
    }
  }, [pkg?.id, pkg?.rev]) // eslint-disable-line react-hooks/exhaustive-deps

  const layers = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = layers.current
    if (!el || !pkg?.hasLayers) return
    let alive = true
    fetch(url(theme, 'layers.html'))
      .then((r) => (r.ok ? r.text() : ''))
      .then((html) => alive && el.replaceChildren(sanitizeLayers(html, pkg)))
      .catch(() => undefined)
    return () => {
      alive = false
      el.replaceChildren()
    }
  }, [pkg?.id, pkg?.rev, pkg?.hasLayers]) // eslint-disable-line react-hooks/exhaustive-deps

  return pkg?.hasLayers ? <div className="tv-layers" ref={layers} aria-hidden="true" /> : null
}
