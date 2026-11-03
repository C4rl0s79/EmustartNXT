import { LOOK_SPEC, type LookChoice, type LookRow, type LookValues } from './look'

// Themes of the TV layout. A theme is three layers on top of the look editor (look.ts):
//   1. palette  — colours as CSS variables on the .tv frame (checked for contrast in tests),
//   2. variants — tested layout choices (how the game list is shown),
//   3. its own stylesheet, scoped to .tv[data-theme="<id>"] (themes/*.css) — built-in themes only.
// The look editor keeps working under every theme; the keys a theme decides itself ("locks") are
// hidden there, so no setting appears that does nothing. The look itself stays EmuStart's (shared
// with standalone EmuStart); the theme id is Lumen's own setting (Settings.tvTheme).
//
// Contract every theme keeps (the pad must always work): the selected game is clearly marked, the
// hints bar and the top bar stay where they are, text has at least 4.5:1 contrast on its background.

export type GamesLayout = 'list' | 'coverflow'

export interface ThemePalette {
  /** page background (solid; gradients and art go on top of it) */
  bg: string
  text: string
  dim: string
  accent: string
  /** the selected row / item: its text on its background */
  selText: string
  selBg: string
  /** panels (info bar, dialogs) */
  panel: string
}

export interface TvTheme {
  id: string
  name: string
  description: string
  palette?: ThemePalette
  games: {
    layout: GamesLayout
    /** coverflow: mirror image of the covers below them */
    reflection?: boolean
  }
  /** moving background drawn by the theme's stylesheet (.tv-ambient); still with reduced motion */
  ambient?: 'embers' | 'stars'
  /** look editor keys this theme decides itself (hidden in the editor) */
  locks: string[]
  /** typefaces offered in the look editor: text and headings, the first one is the theme's default */
  fonts: { text: string[]; head: string[] }
}

/** the theme's own starting look (its typefaces); the player's changes are stored on top of it */
export function lookDefaults(theme: TvTheme): LookValues {
  return { font: theme.fonts.text[0], font_head: theme.fonts.head[0] }
}

export const DEFAULT_THEME = 'emustart'

export const THEMES: TvTheme[] = [
  {
    id: 'emustart',
    name: 'EmuStart',
    description: 'Wygląd EmuStart: lista tytułów, okładka i zrzut obok. Kolory i rozmiary z edytora „Wygląd”.',
    games: { layout: 'list' },
    locks: [],
    fonts: { text: ['segoe', 'atkinson', 'manrope', 'bricolage'], head: ['segoe', 'atkinson', 'manrope', 'bricolage'] }
  },
  {
    id: 'fantasy',
    name: 'Kronika',
    description: 'Fantasy: złocenia na ciemnym drewnie, iskry unoszące się z dołu ekranu. Układ jak w EmuStart.',
    palette: {
      bg: '#130e0b',
      text: '#f1e6cc',
      dim: '#bba98a',
      accent: '#d8a441',
      selText: '#fff6e0',
      selBg: '#5e1a1c',
      panel: 'rgba(30, 21, 16, 0.94)'
    },
    games: { layout: 'list' },
    ambient: 'embers',
    locks: ['accent', 'bg'],
    fonts: { text: ['alegreya', 'atkinson', 'segoe'], head: ['cinzel', 'alegreya', 'atkinson'] }
  },
  {
    id: 'sf',
    name: 'Horyzont',
    description: 'Science fiction: okładki na poziomej wstędze z odbiciem, gwiazdy w tle, grafika gry na całym ekranie.',
    palette: {
      bg: '#060818',
      text: '#e8f1ff',
      dim: '#9fb0d0',
      accent: '#7ee0ff',
      selText: '#04121c',
      selBg: '#7ee0ff',
      panel: 'rgba(8, 11, 30, 0.92)'
    },
    games: { layout: 'coverflow', reflection: true },
    ambient: 'stars',
    // the list's sizes and the title logos do not apply to the cover ribbon
    locks: ['accent', 'bg', 'row', 'list_w', 'media_h', 'tlogo', 'tlogo_w', 'games_logo'],
    fonts: { text: ['exo2', 'atkinson', 'segoe'], head: ['oxanium', 'exo2', 'atkinson'] }
  }
]

export function themeById(id: string | undefined): TvTheme {
  return THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === DEFAULT_THEME)!
}

/** CSS variables of the theme's palette (they win over the look editor's colours, which it locks). */
export function themeStyle(theme: TvTheme): Record<string, string> {
  const p = theme.palette
  if (!p) return {}
  return {
    '--tv-bg': p.bg,
    '--tv-text': p.text,
    '--tv-dim': p.dim,
    '--tv-accent': p.accent,
    '--tv-sel-text': p.selText,
    '--tv-sel-bg': p.selBg,
    '--tv-panel': p.panel
  }
}

/**
 * The look editor's rows for a theme: without the keys it locks (and headings left empty), the font
 * rows offering only the theme's typefaces with its own default.
 */
export function lookSpecFor(theme: TvTheme): LookRow[] {
  const rows = LOOK_SPEC.filter((r) => !('k' in r) || !theme.locks.includes(r.k)).map((r): LookRow => {
    if (!('k' in r) || (r.k !== 'font' && r.k !== 'font_head')) return r
    const opts = r.k === 'font' ? theme.fonts.text : theme.fonts.head
    return { ...(r as LookChoice), opts, def: opts[0] }
  })
  return rows.filter((r, i) => 'k' in r || (i + 1 < rows.length && 'k' in rows[i + 1]))
}

// ---- contrast (WCAG 2): used by the tests that keep every theme readable ----

function channel(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`)
  const n = parseInt(m[1], 16)
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
