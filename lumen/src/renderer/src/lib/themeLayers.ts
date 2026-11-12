import { THEME_SCHEME } from '@shared/api'
import type { ThemePackage } from '@shared/types'

// Dekoracje motywu z paczki (layers.html: cząsteczki, poświaty) — sprawdzone już przez serwer i silnik
// (engine/emustart/themes.py), tu jeszcze raz przy wstawianiu: Lumen działa jako administrator, więc do strony
// trafiają wyłącznie dozwolone znaczniki i atrybuty, budowane od nowa (nic z paczki nie jest wstawiane jako HTML).

export const LAYER_TAGS = new Set([
  'div', 'span', 'i', 'b', 'em', 'strong', 'p', 'img', 'svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line',
  'polyline', 'polygon', 'defs', 'lineargradient', 'radialgradient', 'stop', 'filter', 'fegaussianblur'
])
const SVG_TAGS = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'defs', 'lineargradient',
  'radialgradient', 'stop', 'filter', 'fegaussianblur'])
const SVG_NAME: Record<string, string> = { lineargradient: 'linearGradient', radialgradient: 'radialGradient', fegaussianblur: 'feGaussianBlur' }
export const LAYER_ATTRS = new Set([
  'class', 'aria-hidden', 'role', 'alt', 'width', 'height', 'src', 'viewbox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap',
  'stroke-linejoin', 'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'points', 'transform', 'opacity',
  'fill-opacity', 'stroke-opacity', 'offset', 'stop-color', 'stop-opacity', 'gradientunits', 'gradienttransform', 'id', 'xmlns',
  'preserveaspectratio', 'stddeviation', 'data-n'
])
const SVG_ATTR: Record<string, string> = { viewbox: 'viewBox', gradientunits: 'gradientUnits', gradienttransform: 'gradientTransform',
  preserveaspectratio: 'preserveAspectRatio', stddeviation: 'stdDeviation' }

/** wartość atrybutu dozwolona (bez skryptów i adresów; obraz — tylko plik z assets/ pakietu) */
export function layerValueOk(tag: string, name: string, value: string): boolean {
  const v = value.toLowerCase()
  if (v.includes('javascript:')) return false
  if (v.includes('url(') && !/^url\(#[a-z0-9_-]+\)$/i.test(value)) return false
  if (name === 'src') return tag === 'img' && /^assets\/[A-Za-z0-9 _./-]+$/.test(value) && !value.split('/').includes('..')
  return true
}

export const layerSrc = (pkg: ThemePackage, rel: string): string =>
  `${THEME_SCHEME}://${pkg.id}/${rel.split('/').map(encodeURIComponent).join('/')}?r=${pkg.rev}`

/** HTML dekoracji → bezpieczny fragment (nowe elementy, tylko dozwolone znaczniki i atrybuty; reszta pominięta). */
export function sanitizeLayers(html: string, pkg: ThemePackage, doc: Document = document): DocumentFragment {
  const src = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body
  const out = doc.createDocumentFragment()
  const copy = (from: Node, to: Node, inSvg: boolean): void => {
    from.childNodes.forEach((n) => {
      if (n.nodeType === 3) {
        to.appendChild(doc.createTextNode(n.textContent ?? ''))
        return
      }
      if (n.nodeType !== 1) return
      const el = n as Element
      const tag = el.tagName.toLowerCase()
      if (!LAYER_TAGS.has(tag)) return // niedozwolony znacznik — pominięty razem z zawartością
      const svg = inSvg || tag === 'svg'
      const made = svg && SVG_TAGS.has(tag) ? doc.createElementNS('http://www.w3.org/2000/svg', SVG_NAME[tag] ?? tag) : doc.createElement(tag)
      for (const a of Array.from(el.attributes)) {
        const name = a.name.toLowerCase()
        if (!LAYER_ATTRS.has(name) || name === 'xmlns' || !layerValueOk(tag, name, a.value)) continue
        made.setAttribute(svg ? (SVG_ATTR[name] ?? name) : name, name === 'src' ? layerSrc(pkg, a.value) : a.value)
      }
      to.appendChild(made)
      copy(el, made, svg)
    })
  }
  copy(src, out, false)
  return out
}
